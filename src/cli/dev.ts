import { join } from "path"
import { watch } from "fs"
import { loadConfig } from "../config"
import { createRuntime } from "../runtime"
import { compileShim, shimSourcePath, shimBinaryPath, needsRecompile, spawnShim } from "../shim"
import { createSharedRegion, destroySharedRegion, signalToShim } from "../ipc/shmem"
import { loadMenu } from "../menu"
import { serializeMenu } from "../menu"
import { runDoctor, printDoctorResults } from "./doctor"
import { buildNativeExtensions } from "../native/build"
import type { IpcMessage } from "../types"

const SHM_SIZE = 128 * 1024
const HEADER_SIZE = 64
const RING_SIZE = (SHM_SIZE - HEADER_SIZE) / 2
const TO_BUN_OFFSET = HEADER_SIZE
const TO_SHIM_OFFSET = HEADER_SIZE + RING_SIZE
const POLL_MS = Math.floor(1000 / 60)

const readU32 = (buf: Uint8Array, offset: number): number => {
  const view = new DataView(buf.buffer, buf.byteOffset + offset)
  return view.getUint32(0, true)
}

const writeU32 = (buf: Uint8Array, offset: number, value: number): void => {
  const view = new DataView(buf.buffer, buf.byteOffset + offset)
  view.setUint32(0, value, true)
}

const ringAvailable = (w: number, r: number): number =>
  w >= r ? w - r : RING_SIZE - r + w

const ringFree = (w: number, r: number): number =>
  r > w ? r - w - 1 : RING_SIZE - (w - r) - 1

const readByte = (buf: Uint8Array, base: number, cursor: number): number =>
  buf[base + (cursor % RING_SIZE)]

const readFromShim = (buf: Uint8Array): IpcMessage[] => {
  const messages: IpcMessage[] = []

  let w = readU32(buf, 0)
  let r = readU32(buf, 4)

  while (ringAvailable(w, r) >= 4) {
    const b0 = readByte(buf, TO_BUN_OFFSET, r)
    const b1 = readByte(buf, TO_BUN_OFFSET, r + 1)
    const b2 = readByte(buf, TO_BUN_OFFSET, r + 2)
    const b3 = readByte(buf, TO_BUN_OFFSET, r + 3)
    const len = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)

    if (ringAvailable(w, (r + 4) % RING_SIZE) < len) break

    let cursor = (r + 4) % RING_SIZE
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = readByte(buf, TO_BUN_OFFSET, cursor)
      cursor = (cursor + 1) % RING_SIZE
    }

    r = cursor
    writeU32(buf, 4, r)

    const json = new TextDecoder().decode(bytes)
    try {
      messages.push(JSON.parse(json) as IpcMessage)
    } catch {
      // skip malformed messages
    }

    w = readU32(buf, 0)
  }

  return messages
}

const writeByte = (buf: Uint8Array, base: number, cursor: number, value: number): void => {
  buf[base + (cursor % RING_SIZE)] = value
}

const writeToShim = (buf: Uint8Array, msg: IpcMessage): boolean => {
  const json = JSON.stringify(msg)
  const payload = new TextEncoder().encode(json)
  const needed = 4 + payload.length

  const w = readU32(buf, 8)
  const r = readU32(buf, 12)

  if (ringFree(w, r) < needed) return false

  let cursor = w

  // write length prefix
  writeByte(buf, TO_SHIM_OFFSET, cursor, payload.length & 0xff)
  cursor = (cursor + 1) % RING_SIZE
  writeByte(buf, TO_SHIM_OFFSET, cursor, (payload.length >> 8) & 0xff)
  cursor = (cursor + 1) % RING_SIZE
  writeByte(buf, TO_SHIM_OFFSET, cursor, (payload.length >> 16) & 0xff)
  cursor = (cursor + 1) % RING_SIZE
  writeByte(buf, TO_SHIM_OFFSET, cursor, (payload.length >> 24) & 0xff)
  cursor = (cursor + 1) % RING_SIZE

  // write payload
  for (let i = 0; i < payload.length; i++) {
    writeByte(buf, TO_SHIM_OFFSET, cursor, payload[i])
    cursor = (cursor + 1) % RING_SIZE
  }

  writeU32(buf, 8, cursor)
  return true
}

const copyAssets = async (srcDir: string, destDir: string): Promise<void> => {
  const { readdir } = await import("fs/promises")
  const entries = await readdir(srcDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const src = join(srcDir, entry.name)
    const dest = join(destDir, entry.name)
    if (entry.isDirectory()) {
      await Bun.$`mkdir -p ${dest}`.quiet()
      await copyAssets(src, dest)
    } else {
      const ext = entry.name.split(".").pop()?.toLowerCase() ?? ""
      // Skip files the bundler handles — copy everything else (images, fonts, etc.)
      if (!["ts", "tsx", "js", "jsx", "css", "html"].includes(ext)) {
        await Bun.write(dest, Bun.file(src))
      }
    }
  }
}

const bundleApp = async (projectDir: string, entry: string): Promise<string> => {
  const outdir = join(projectDir, ".butter", "build")
  await Bun.build({
    entrypoints: [join(projectDir, entry)],
    outdir,
    minify: false,
    sourcemap: "inline",
  })

  // Copy static assets (images, fonts, etc.) that the bundler doesn't process
  const appDir = join(projectDir, "src", "app")
  await copyAssets(appDir, outdir)

  // Strip crossorigin attributes (not needed with butter:// protocol, but harmless to remove)
  const htmlPath = join(outdir, "index.html")
  const html = await Bun.file(htmlPath).text()
  await Bun.write(htmlPath, html.replaceAll(' crossorigin', ''))

  return outdir
}

let nextMsgId = 1

const makeMsg = (type: IpcMessage["type"], action: string, data?: unknown): IpcMessage => ({
  id: String(nextMsgId++),
  type,
  action,
  data,
})

export const runDev = async (projectDir: string): Promise<void> => {
  // 1. Doctor checks
  const results = await runDoctor()
  const allOk = printDoctorResults(results)
  if (!allOk) {
    console.error("\nFix the issues above before running dev mode.")
    process.exit(1)
  }

  // 2. Load config
  const config = await loadConfig(projectDir)
  console.log(`\nStarting dev mode for "${config.window.title}"`)

  // 3. Compile shim if stale
  const source = shimSourcePath()
  const binary = shimBinaryPath(projectDir)
  if (await needsRecompile(binary, source)) {
    console.log("Compiling native shim...")
    await compileShim(projectDir)
  }

  // 4. Build native extensions (if any)
  await buildNativeExtensions(projectDir)

  // 5. Bundle app assets
  console.log("Bundling app...")
  const buildDir = await bundleApp(projectDir, config.build.entry)
  const htmlPath = join(buildDir, "index.html")

  // 6. Create shared memory
  const shmName = `/butter_${process.pid}`
  const region = createSharedRegion(shmName, SHM_SIZE)

  // zero out the header
  for (let i = 0; i < HEADER_SIZE; i++) {
    region.buffer[i] = 0
  }

  // 6. Build env vars
  const env: Record<string, string> = {
    BUTTER_TITLE: config.window.title,
    BUTTER_DEV: "1",
  }
  if (config.window.icon) {
    env.BUTTER_ICON = join(projectDir, config.window.icon)
  }
  if (config.security?.csp) {
    env.BUTTER_CSP = config.security.csp
  }
  if (config.splash) {
    env.BUTTER_SPLASH = join(projectDir, config.splash)
  }

  // Load and pass menu if present
  const menu = await loadMenu(projectDir)
  if (menu) {
    env.BUTTER_MENU = serializeMenu(menu, process.platform)
  }

  // Spawn shim
  console.log("Launching window...")
  const shimProc = await spawnShim(binary, shmName, htmlPath, env)

  // 7. Set up runtime and import host code
  const runtime = createRuntime(config.window)
  globalThis.__butterRuntime = runtime

  try {
    const hostPath = join(projectDir, config.build.host)
    await import(hostPath)
  } catch (err) {
    console.error("Failed to load host code:", err)
  }

  // 8. Build allowlist matcher
  const allowlist = config.security?.allowlist ?? null
  const isAllowed = (action: string): boolean => {
    if (!allowlist) return true
    return allowlist.some((pattern) => {
      if (pattern === "*") return true
      if (pattern.endsWith(":*")) {
        return action.startsWith(pattern.slice(0, -1))
      }
      return action === pattern
    })
  }

  // 9. Poll loop
  let running = true

  const poll = () => {
    if (!running) return

    // Read messages from shim
    const incoming = readFromShim(region.buffer)
    for (const msg of incoming) {
      if (msg.type === "invoke") {
        const sendResponse = (result: unknown, error?: string) => {
          const response = makeMsg("response", msg.action, result)
          response.id = msg.id
          if (error) response.error = error
          if (writeToShim(region.buffer, response)) signalToShim(region)
        }

        // Enforce allowlist
        if (!isAllowed(msg.action)) {
          sendResponse(undefined, `Action "${msg.action}" is not allowed by security.allowlist`)
          continue
        }

        try {
          const result = runtime.dispatch(msg.action, msg.data)
          if (result instanceof Promise) {
            result.then(
              (v) => sendResponse(v),
              (e) => sendResponse(undefined, e instanceof Error ? e.message : String(e)),
            )
          } else {
            sendResponse(result)
          }
        } catch (err) {
          sendResponse(undefined, err instanceof Error ? err.message : String(err))
        }
      } else if (msg.type === "response") {
        // Control responses from the shim (dialogs, window ops) — resolve pending promise
        runtime.resolveControl(msg.id, msg.data)
      } else if (msg.type === "event") {
        // Menu actions and other events from the shim — dispatch to host handlers
        runtime.dispatch(msg.action, msg.data)
      } else if (msg.type === "control" && msg.action === "quit") {
        running = false
        return
      }
    }

    // Flush outgoing events
    const outgoing = runtime.drainOutgoing()
    let wrote = false
    for (const msg of outgoing) {
      if (writeToShim(region.buffer, msg)) {
        wrote = true
      }
    }
    if (wrote) {
      signalToShim(region)
    }

    setTimeout(poll, POLL_MS)
  }

  poll()

  // 9. Watch for file changes
  const srcDir = join(projectDir, "src")
  const watcher = watch(srcDir, { recursive: true }, async (eventType, filename) => {
    if (!filename || !running) return
    console.log(`File changed: ${filename}, rebuilding...`)
    try {
      await bundleApp(projectDir, config.build.entry)
      const reloadMsg = makeMsg("control", "reload")
      if (writeToShim(region.buffer, reloadMsg)) {
        signalToShim(region)
      }
    } catch (err) {
      console.error("Rebuild failed:", err)
    }
  })

  // 10. Handle shim exit
  shimProc.exited.then(() => {
    running = false
    watcher.close()
    destroySharedRegion(shmName)
    console.log("\nWindow closed.")
    process.exit(0)
  })

  // 11. Handle SIGINT
  process.on("SIGINT", () => {
    console.log("\nShutting down...")
    const quitMsg = makeMsg("control", "quit")
    if (writeToShim(region.buffer, quitMsg)) {
      signalToShim(region)
    }
    setTimeout(() => {
      running = false
      watcher.close()
      destroySharedRegion(shmName)
      process.exit(0)
    }, 1000)
  })
}
