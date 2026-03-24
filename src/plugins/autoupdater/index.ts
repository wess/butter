import { join } from "path"
import { tmpdir } from "os"
import { mkdirSync } from "fs"
import type { Plugin, HostContext } from "../../types"

type UpdateManifest = {
  version: string
  url: string
  notes?: string
}

type CheckResult =
  | { available: false }
  | { available: true; version: string; url: string; notes?: string }

const parseVersion = (v: string): number[] =>
  v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0)

const isNewer = (remote: string, current: string): boolean => {
  const r = parseVersion(remote)
  const c = parseVersion(current)
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const rv = r[i] ?? 0
    const cv = c[i] ?? 0
    if (rv > cv) return true
    if (rv < cv) return false
  }
  return false
}

const fetchManifest = async (url: string): Promise<UpdateManifest> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status} ${res.statusText}`)
  return res.json() as Promise<UpdateManifest>
}

const currentVersion = (): string => {
  try {
    const pkg = require(join(process.cwd(), "package.json"))
    return pkg.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

const host = (ctx: HostContext): void => {
  ctx.on("updater:check", async (data: unknown) => {
    const { url } = data as { url: string }
    if (!url) return { ok: false, error: "updater:check requires { url: string }" }

    try {
      const manifest = await fetchManifest(url)
      const current = currentVersion()

      if (isNewer(manifest.version, current)) {
        const result: CheckResult = {
          available: true,
          version: manifest.version,
          url: manifest.url,
          notes: manifest.notes,
        }
        return { ok: true, ...result }
      }

      return { ok: true, available: false }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("updater:download", async (data: unknown) => {
    const { url, filename } = data as { url: string; filename?: string }
    if (!url) return { ok: false, error: "updater:download requires { url: string }" }

    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)

      const destDir = join(tmpdir(), "butter-update")
      mkdirSync(destDir, { recursive: true })

      const name = filename ?? url.split("/").pop() ?? "update"
      const destPath = join(destDir, name)

      const buffer = await res.arrayBuffer()
      await Bun.write(destPath, buffer)

      return { ok: true, path: destPath }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.updater = {
    check: function (url) {
      return window.butter.invoke("updater:check", { url: url });
    },
    download: function (url, filename) {
      return window.butter.invoke("updater:download", { url: url, filename: filename });
    }
  };
})();
`

const autoupdater: Plugin = {
  name: "autoupdater",
  host,
  webview,
}

export default autoupdater
