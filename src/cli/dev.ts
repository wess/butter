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
import { createMcpServer } from "../mcp"
import type { IpcMessage } from "../types"

const SHM_SIZE = 128 * 1024
const HEADER_SIZE = 64
const RING_SIZE = (SHM_SIZE - HEADER_SIZE) / 2
const TO_BUN_OFFSET = HEADER_SIZE
const TO_SHIM_OFFSET = HEADER_SIZE + RING_SIZE
const POLL_MS = Math.floor(1000 / 60)

// Frame format: [len:u32 LE][flags:u32 LE][payload:bytes]. A logical message
// may span multiple frames; only the final frame has FLAG_LAST set. This
// lets payloads larger than RING_SIZE stream through across multiple
// reader drains (the previous single-frame format truncated silently).
const FRAME_HEADER_SIZE = 8
const FLAG_LAST = 1
const MAX_CHUNK_PAYLOAD = 16 * 1024

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

type IpcState = {
  buf: Uint8Array
  // Outgoing frames waiting to drain into the to-shim ring (FIFO).
  pendingWrite: { bytes: Uint8Array; offset: number }[]
  // Reassembly state for incoming chunks from the to-bun ring.
  reassembly: Uint8Array[]
  reassemblyLen: number
}

const createIpcState = (buf: Uint8Array): IpcState => ({
  buf,
  pendingWrite: [],
  reassembly: [],
  reassemblyLen: 0,
})

// Reused across all IPC encode/decode calls — TextEncoder/TextDecoder
// allocations show up surprisingly high in profiles for high-frequency IPC.
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const buildFrame = (payload: Uint8Array, flags: number): Uint8Array => {
  const frame = new Uint8Array(FRAME_HEADER_SIZE + payload.length)
  const view = new DataView(frame.buffer)
  view.setUint32(0, payload.length, true)
  view.setUint32(4, flags, true)
  frame.set(payload, FRAME_HEADER_SIZE)
  return frame
}

const enqueueOutgoing = (state: IpcState, msg: IpcMessage): void => {
  const json = JSON.stringify(msg)
  const payload = encoder.encode(json)
  if (payload.length === 0) {
    state.pendingWrite.push({ bytes: buildFrame(payload, FLAG_LAST), offset: 0 })
    return
  }
  let offset = 0
  while (offset < payload.length) {
    const chunkLen = Math.min(payload.length - offset, MAX_CHUNK_PAYLOAD)
    const isLast = offset + chunkLen >= payload.length
    const frame = buildFrame(
      payload.subarray(offset, offset + chunkLen),
      isLast ? FLAG_LAST : 0,
    )
    state.pendingWrite.push({ bytes: frame, offset: 0 })
    offset += chunkLen
  }
}

// Copy `n` bytes from src into the ring at base+cursor, wrapping at RING_SIZE.
// Uses Uint8Array.set (memcpy) for both the contiguous and split-wrap cases.
const ringWrite = (
  buf: Uint8Array,
  base: number,
  cursor: number,
  src: Uint8Array,
  n: number,
): void => {
  const tail = RING_SIZE - cursor
  if (n <= tail) {
    buf.set(src.subarray(0, n), base + cursor)
  } else {
    buf.set(src.subarray(0, tail), base + cursor)
    buf.set(src.subarray(tail, n), base)
  }
}

// Read `n` bytes from the ring starting at cursor into a fresh Uint8Array.
const ringRead = (buf: Uint8Array, base: number, cursor: number, n: number): Uint8Array => {
  const tail = RING_SIZE - cursor
  if (n <= tail) return buf.slice(base + cursor, base + cursor + n)
  const out = new Uint8Array(n)
  out.set(buf.subarray(base + cursor, base + RING_SIZE), 0)
  out.set(buf.subarray(base, base + n - tail), tail)
  return out
}

// Push as many bytes from pendingWrite as fit in the to-shim ring. Returns
// true if at least one byte was written (caller should signal the shim).
const flushToShim = (state: IpcState): boolean => {
  let anyWritten = false
  while (state.pendingWrite.length > 0) {
    const item = state.pendingWrite[0]!
    const remaining = item.bytes.length - item.offset
    if (remaining <= 0) {
      state.pendingWrite.shift()
      continue
    }
    const w = readU32(state.buf, 8)
    const r = readU32(state.buf, 12)
    const space = ringFree(w, r)
    if (space === 0) break
    const toWrite = Math.min(remaining, space)
    ringWrite(state.buf, TO_SHIM_OFFSET, w, item.bytes.subarray(item.offset), toWrite)
    writeU32(state.buf, 8, (w + toWrite) % RING_SIZE)
    item.offset += toWrite
    anyWritten = true
    if (item.offset >= item.bytes.length) {
      state.pendingWrite.shift()
    } else {
      // Ring full; resume on next flush.
      break
    }
  }
  return anyWritten
}

const mergeReassembly = (state: IpcState): Uint8Array => {
  if (state.reassembly.length === 1) {
    const out = state.reassembly[0]!
    state.reassembly = []
    state.reassemblyLen = 0
    return out
  }
  const merged = new Uint8Array(state.reassemblyLen)
  let p = 0
  for (const c of state.reassembly) {
    merged.set(c, p)
    p += c.length
  }
  state.reassembly = []
  state.reassemblyLen = 0
  return merged
}

// Drain the to-bun ring, reassembling chunked frames into complete messages.
const readFromShim = (state: IpcState): IpcMessage[] => {
  const messages: IpcMessage[] = []

  while (true) {
    const w = readU32(state.buf, 0)
    const r = readU32(state.buf, 4)
    const used = ringAvailable(w, r)
    if (used < FRAME_HEADER_SIZE) break

    const hdr = ringRead(state.buf, TO_BUN_OFFSET, r, FRAME_HEADER_SIZE)
    const view = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength)
    const len = view.getUint32(0, true)
    const flags = view.getUint32(4, true)

    if (used < FRAME_HEADER_SIZE + len) break

    const payloadStart = (r + FRAME_HEADER_SIZE) % RING_SIZE
    const payload = ringRead(state.buf, TO_BUN_OFFSET, payloadStart, len)
    writeU32(state.buf, 4, (r + FRAME_HEADER_SIZE + len) % RING_SIZE)

    if (len > 0) {
      state.reassembly.push(payload)
      state.reassemblyLen += payload.length
    }

    if (flags & FLAG_LAST) {
      const merged = mergeReassembly(state)
      try {
        messages.push(JSON.parse(decoder.decode(merged)) as IpcMessage)
      } catch {
        // skip malformed; the next frame may begin a fresh message
      }
    }
  }

  return messages
}

const copyAssets = async (srcDir: string, destDir: string): Promise<void> => {
  const { readdir } = await import("fs/promises")
  const entries = await readdir(srcDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const src = join(srcDir, entry.name)
    const dest = join(destDir, entry.name)
    if (entry.isDirectory()) {
      const { mkdir } = await import("fs/promises")
      await mkdir(dest, { recursive: true })
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
  const shmName = process.platform === "win32"
    ? `butter_${process.pid}`
    : `/butter_${process.pid}`
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

  // 7b. Boot MCP dev server
  const mcpEnabled = config.dev?.mcp?.enabled !== false && process.env.BUTTER_MCP !== "0"
  const mcpPort = Number(process.env.BUTTER_MCP_PORT ?? config.dev?.mcp?.port ?? 4711)
  const mcpBufferSize = config.dev?.mcp?.consoleBuffer ?? 1000

  let mcpServer: ReturnType<typeof createMcpServer> | null = null
  if (mcpEnabled) {
    mcpServer = createMcpServer({
      port: mcpPort,
      consoleBuffer: mcpBufferSize,
      control: (action, data) => runtime.control(action, data),
    })
    try {
      await mcpServer.start()
      console.log(`  MCP server listening on http://127.0.0.1:${mcpPort}/mcp`)
    } catch (err) {
      console.error(
        `MCP port ${mcpPort} is already in use. Set dev.mcp.port in butter.yaml ` +
        `or BUTTER_MCP_PORT env var, or set dev.mcp.enabled: false to disable.`,
      )
      process.exit(1)
    }

    runtime.tap("console:message", (data) => {
      const m = data as { level: string; text: string }
      mcpServer?.recordConsole({ level: m.level as "log" | "warn" | "error" | "info", text: m.text })
    })
  } else {
    console.log("  MCP server: disabled")
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
  const ipc = createIpcState(region.buffer)

  const sendMessage = (msg: IpcMessage): void => {
    enqueueOutgoing(ipc, msg)
  }

  const poll = () => {
    if (!running) return

    // Read messages from shim
    const incoming = readFromShim(ipc)
    for (const msg of incoming) {
      if (msg.type === "invoke") {
        const sendResponse = (result: unknown, error?: string) => {
          const response = makeMsg("response", msg.action, result)
          response.id = msg.id
          if (error) response.error = error
          sendMessage(response)
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

    // Queue outgoing events (chunked into frames as needed)
    const outgoing = runtime.drainOutgoing()
    for (const msg of outgoing) {
      enqueueOutgoing(ipc, msg)
    }

    // Push as many bytes as fit; signal the shim if anything was written.
    if (flushToShim(ipc)) {
      signalToShim(region)
    }

    setTimeout(poll, POLL_MS)
  }

  poll()

  // 9. Watch for file changes (debounced)
  const srcDir = join(projectDir, "src")
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null

  const watcher = watch(srcDir, { recursive: true }, (eventType, filename) => {
    if (!filename || !running) return
    if (rebuildTimer) clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(async () => {
      rebuildTimer = null
      console.log(`File changed: ${filename}, rebuilding...`)
      try {
        await bundleApp(projectDir, config.build.entry)
        enqueueOutgoing(ipc, makeMsg("control", "reload"))
        if (flushToShim(ipc)) signalToShim(region)
      } catch (err) {
        console.error("Rebuild failed:", err)
      }
    }, 200)
  })

  // 10. Cleanup helper
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    running = false
    if (mcpServer) {
      try { await mcpServer.stop() } catch {}
      mcpServer = null
    }
    watcher.close()
    try { destroySharedRegion(shmName) } catch {}
  }

  // 11. Handle shim exit
  shimProc.exited.then(async () => {
    await cleanup()
    console.log("\nWindow closed.")
    process.exit(0)
  })

  // 12. Handle SIGINT
  process.on("SIGINT", () => {
    console.log("\nShutting down...")
    enqueueOutgoing(ipc, makeMsg("control", "quit"))
    if (flushToShim(ipc)) signalToShim(region)
    setTimeout(async () => {
      await cleanup()
      process.exit(0)
    }, 1000)
  })

  // 13. Handle unexpected crashes — clean up shared memory
  process.on("uncaughtException", async (err) => {
    console.error("Uncaught exception:", err)
    await cleanup()
    process.exit(1)
  })

  process.on("unhandledRejection", async (err) => {
    console.error("Unhandled rejection:", err)
    await cleanup()
    process.exit(1)
  })
}
