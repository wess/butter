import type { Plugin, HostContext } from "../../types"
import { existsSync } from "fs"
import { join, basename, isAbsolute } from "path"

// Sidecar binaries — external executables shipped alongside the app
// (ffmpeg, yt-dlp, a Go daemon, etc.). Declared in butter.yaml under
// bundle.sidecars and looked up by basename. In dev mode they resolve
// relative to the project root; in a compiled binary the bundle copies
// them to <bundle>/sidecars/ and BUTTER_SIDECARS_DIR points at it.

type SpawnParams = { name: string; args?: string[]; cwd?: string; env?: Record<string, string> }

type Running = {
  proc: ReturnType<typeof Bun.spawn>
  name: string
}

const processes = new Map<string, Running>()
let nextId = 1
const encoder = new TextEncoder()

const sidecarPaths = (): Map<string, string> => {
  const map = new Map<string, string>()
  const raw = process.env.BUTTER_SIDECARS ?? ""
  if (!raw) return map
  for (const entry of raw.split(":::")) {
    if (!entry) continue
    const [name, path] = entry.split("==", 2)
    if (name && path) map.set(name, path)
  }
  return map
}

const resolveSidecar = (name: string): string | null => {
  const paths = sidecarPaths()
  const direct = paths.get(name)
  if (direct && existsSync(direct)) return direct
  // Fallback: per-platform bundled dir
  const dir = process.env.BUTTER_SIDECARS_DIR
  if (dir) {
    const ext = process.platform === "win32" ? ".exe" : ""
    const candidate = join(dir, `${name}${ext}`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

const streamReader = async (
  stream: ReadableStream<Uint8Array> | null | undefined,
  emit: (text: string) => void,
): Promise<void> => {
  if (!stream) return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) emit(decoder.decode(value, { stream: true }))
  }
}

const host = (ctx: HostContext): void => {
  ctx.on("sidecar:list", () => {
    const map = sidecarPaths()
    return { ok: true, names: [...map.keys()] }
  })

  ctx.on("sidecar:spawn", (data: unknown) => {
    const { name, args, cwd, env } = data as SpawnParams
    if (!name) return { ok: false, error: "name required" }
    const path = resolveSidecar(name)
    if (!path) return { ok: false, error: `sidecar not found: ${name}` }
    const id = `sc_${nextId++}`
    const proc = Bun.spawn([path, ...(args ?? [])], {
      cwd,
      env: { ...process.env, ...(env ?? {}) },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    processes.set(id, { proc, name })

    streamReader(proc.stdout as ReadableStream<Uint8Array>, (text) =>
      ctx.send("sidecar:stdout", { id, name, data: text }),
    ).catch(() => {})
    streamReader(proc.stderr as ReadableStream<Uint8Array>, (text) =>
      ctx.send("sidecar:stderr", { id, name, data: text }),
    ).catch(() => {})

    proc.exited.then((code) => {
      processes.delete(id)
      ctx.send("sidecar:exit", { id, name, code })
    })

    return { ok: true, id }
  })

  ctx.on("sidecar:write", async (data: unknown) => {
    const { id, text } = data as { id: string; text: string }
    const r = processes.get(id)
    if (!r) return { ok: false, error: "unknown sidecar id" }
    const stdin = r.proc.stdin
    if (!stdin || typeof (stdin as { write?: unknown }).write !== "function") {
      return { ok: false, error: "stdin not writable" }
    }
    try {
      ;(stdin as { write: (chunk: Uint8Array) => unknown }).write(encoder.encode(text))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("sidecar:kill", (data: unknown) => {
    const { id, signal } = data as { id: string; signal?: NodeJS.Signals | number }
    const r = processes.get(id)
    if (!r) return { ok: false, error: "unknown sidecar id" }
    try {
      r.proc.kill(signal ?? "SIGTERM")
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  function unwrap(p) { return p.then(function (r) { if (!r || !r.ok) throw new Error((r && r.error) || "sidecar error"); return r; }); }
  var listeners = { stdout: {}, stderr: {}, exit: {} };
  function dispatch(kind, data) {
    var list = listeners[kind][data.id] || [];
    list.forEach(function (fn) { try { fn(data); } catch (e) {} });
  }
  if (window.__butterOn) {
    window.__butterOn("sidecar:stdout", function (d) { dispatch("stdout", d); });
    window.__butterOn("sidecar:stderr", function (d) { dispatch("stderr", d); });
    window.__butterOn("sidecar:exit", function (d) { dispatch("exit", d); });
  }
  function attachHandle(id) {
    return {
      id: id,
      write: function (text) { return unwrap(window.butter.invoke("sidecar:write", { id: id, text: text })); },
      kill: function (signal) { return unwrap(window.butter.invoke("sidecar:kill", { id: id, signal: signal })); },
      onStdout: function (fn) { (listeners.stdout[id] = listeners.stdout[id] || []).push(fn); },
      onStderr: function (fn) { (listeners.stderr[id] = listeners.stderr[id] || []).push(fn); },
      onExit: function (fn) { (listeners.exit[id] = listeners.exit[id] || []).push(fn); }
    };
  }
  window.butter.sidecar = {
    list: function () { return unwrap(window.butter.invoke("sidecar:list")).then(function (r) { return r.names; }); },
    spawn: function (name, opts) {
      opts = opts || {};
      return unwrap(window.butter.invoke("sidecar:spawn", { name: name, args: opts.args || [], cwd: opts.cwd, env: opts.env }))
        .then(function (r) { return attachHandle(r.id); });
    }
  };
})();
`

const sidecar: Plugin = {
  name: "sidecar",
  host,
  webview,
}

export default sidecar
