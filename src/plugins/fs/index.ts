import type { Plugin, HostContext } from "../../types"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { resolve } from "node:path"

type PathParams = { path: string }
type WriteParams = { path: string; content: string }

const safePath = (path: string): string => {
  const resolved = resolve(path)
  const cwd = process.cwd()
  if (!resolved.startsWith(cwd)) {
    throw new Error("Path must be within the project directory")
  }
  return resolved
}

const host = (ctx: HostContext): void => {
  ctx.on("fs:read", async (data: unknown) => {
    const { path } = data as PathParams
    if (!path) return { ok: false, error: "path is required" }
    try {
      const file = Bun.file(safePath(path))
      const content = await file.text()
      return { ok: true, content }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("fs:readbinary", async (data: unknown) => {
    const { path } = data as PathParams
    if (!path) return { ok: false, error: "path is required" }
    try {
      const file = Bun.file(safePath(path))
      const buf = await file.arrayBuffer()
      const content = Buffer.from(buf).toString("base64")
      return { ok: true, content }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("fs:write", async (data: unknown) => {
    const { path, content } = data as WriteParams
    if (!path) return { ok: false, error: "path is required" }
    try {
      await Bun.write(safePath(path), content ?? "")
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("fs:writebinary", async (data: unknown) => {
    const { path, content } = data as WriteParams
    if (!path) return { ok: false, error: "path is required" }
    try {
      const buf = Buffer.from(content, "base64")
      await Bun.write(safePath(path), buf)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("fs:exists", async (data: unknown) => {
    const { path } = data as PathParams
    if (!path) return { ok: false, error: "path is required" }
    try {
      return { ok: true, exists: existsSync(safePath(path)) }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("fs:mkdir", async (data: unknown) => {
    const { path } = data as PathParams
    if (!path) return { ok: false, error: "path is required" }
    try {
      mkdirSync(safePath(path), { recursive: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("fs:readdir", async (data: unknown) => {
    const { path } = data as PathParams
    if (!path) return { ok: false, error: "path is required" }
    try {
      const entries = readdirSync(safePath(path), { withFileTypes: true }).map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      }))
      return { ok: true, entries }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("fs:remove", async (data: unknown) => {
    const { path } = data as PathParams
    if (!path) return { ok: false, error: "path is required" }
    try {
      rmSync(safePath(path), { recursive: true, force: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("fs:stat", async (data: unknown) => {
    const { path } = data as PathParams
    if (!path) return { ok: false, error: "path is required" }
    try {
      const s = statSync(safePath(path))
      return {
        ok: true,
        stat: {
          size: s.size,
          modified: s.mtimeMs,
          created: s.birthtimeMs,
          isDirectory: s.isDirectory(),
          isFile: s.isFile(),
        },
      }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.fs = {
    read: function (path) {
      return window.butter.invoke("fs:read", { path: path });
    },
    readBinary: function (path) {
      return window.butter.invoke("fs:readbinary", { path: path });
    },
    write: function (path, content) {
      return window.butter.invoke("fs:write", { path: path, content: content });
    },
    writeBinary: function (path, content) {
      return window.butter.invoke("fs:writebinary", { path: path, content: content });
    },
    exists: function (path) {
      return window.butter.invoke("fs:exists", { path: path });
    },
    mkdir: function (path) {
      return window.butter.invoke("fs:mkdir", { path: path });
    },
    readdir: function (path) {
      return window.butter.invoke("fs:readdir", { path: path });
    },
    remove: function (path) {
      return window.butter.invoke("fs:remove", { path: path });
    },
    stat: function (path) {
      return window.butter.invoke("fs:stat", { path: path });
    }
  };
})();
`

const fs: Plugin = {
  name: "fs",
  host,
  webview,
}

export default fs
