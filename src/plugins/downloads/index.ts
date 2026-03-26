import type { Plugin, HostContext } from "../../types"
import { join } from "node:path"
import { tmpdir } from "node:os"

type StartParams = { url: string; path?: string; filename?: string }
type CancelParams = { id: string }
type Download = {
  id: string
  url: string
  path: string
  status: "active" | "complete" | "error" | "cancelled"
  received: number
  total: number
  percent: number
  error?: string
}

let nextId = 1
const generateId = (): string => `dl_${nextId++}`

const host = (ctx: HostContext): void => {
  const downloads = new Map<string, Download>()
  const controllers = new Map<string, AbortController>()

  ctx.on("download:start", async (data: unknown) => {
    const params = data as StartParams
    if (!params?.url) return { ok: false, error: "url is required" }

    const id = generateId()
    const filename = params.filename ?? params.url.split("/").pop() ?? "download"
    const destPath = params.path ? join(params.path, filename) : join(tmpdir(), filename)

    const dl: Download = {
      id,
      url: params.url,
      path: destPath,
      status: "active",
      received: 0,
      total: 0,
      percent: 0,
    }
    downloads.set(id, dl)

    const controller = new AbortController()
    controllers.set(id, controller)

    const run = async () => {
      try {
        const response = await fetch(params.url, { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const contentLength = response.headers.get("content-length")
        dl.total = contentLength ? Number.parseInt(contentLength, 10) : 0

        const reader = response.body?.getReader()
        if (!reader) throw new Error("No response body")

        const chunks: Uint8Array[] = []
        let received = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          chunks.push(value)
          received += value.length
          dl.received = received
          dl.percent = dl.total > 0 ? Math.round((received / dl.total) * 100) : 0

          ctx.send("download:progress", {
            id,
            received: dl.received,
            total: dl.total,
            percent: dl.percent,
          })
        }

        const blob = new Blob(chunks)
        await Bun.write(destPath, blob)

        dl.status = "complete"
        dl.percent = 100
        downloads.set(id, dl)
        ctx.send("download:complete", { id, path: destPath })
      } catch (err) {
        if (controller.signal.aborted) {
          dl.status = "cancelled"
          downloads.set(id, dl)
          return
        }
        dl.status = "error"
        dl.error = String(err)
        downloads.set(id, dl)
        ctx.send("download:error", { id, error: String(err) })
      } finally {
        controllers.delete(id)
      }
    }

    run()
    return { ok: true, id, path: destPath }
  })

  ctx.on("download:cancel", async (data: unknown) => {
    const { id } = data as CancelParams
    if (!id) return { ok: false, error: "id is required" }

    const controller = controllers.get(id)
    if (!controller) return { ok: false, error: "download not found or already finished" }

    controller.abort()
    controllers.delete(id)
    return { ok: true }
  })

  ctx.on("download:list", async (_data: unknown) => {
    const list = Array.from(downloads.values())
    return { ok: true, downloads: list }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  var progressListeners = [];
  var completeListeners = [];
  var errorListeners = [];
  window.butter.downloads = {
    start: function (url, opts) {
      var params = { url: url };
      if (opts && opts.path) params.path = opts.path;
      if (opts && opts.filename) params.filename = opts.filename;
      return window.butter.invoke("download:start", params);
    },
    cancel: function (id) {
      return window.butter.invoke("download:cancel", { id: id });
    },
    list: function () {
      return window.butter.invoke("download:list");
    },
    onProgress: function (handler) {
      progressListeners.push(handler);
    },
    onComplete: function (handler) {
      completeListeners.push(handler);
    },
    onError: function (handler) {
      errorListeners.push(handler);
    }
  };
  window.butter.on("download:progress", function (data) {
    progressListeners.forEach(function (fn) { fn(data); });
  });
  window.butter.on("download:complete", function (data) {
    completeListeners.forEach(function (fn) { fn(data); });
  });
  window.butter.on("download:error", function (data) {
    errorListeners.forEach(function (fn) { fn(data); });
  });
})();
`

const downloads: Plugin = {
  name: "downloads",
  host,
  webview,
}

export default downloads
