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

  ctx.on("updater:install", async (data: unknown) => {
    const { path } = data as { path: string }
    if (!path) return { ok: false, error: "updater:install requires { path: string }" }

    try {
      const platform = process.platform
      const ext = path.split(".").pop()?.toLowerCase() ?? ""

      if (platform === "darwin") {
        if (ext === "dmg") {
          // Mount DMG and copy app
          await Bun.$`hdiutil attach ${path} -nobrowse -quiet`
          const mounted = await Bun.$`hdiutil info -plist`.text()
          // Open the DMG volume so user can drag to Applications
          await Bun.$`open ${path}`
          return { ok: true, action: "opened" }
        } else if (ext === "zip") {
          const destDir = join(tmpdir(), "butter-update-extracted")
          await Bun.$`unzip -o ${path} -d ${destDir}`.quiet()
          // Find .app in extracted contents
          const result = await Bun.$`find ${destDir} -maxdepth 2 -name "*.app" -type d`.text()
          const appPath = result.trim().split("\n")[0]
          if (appPath) {
            await Bun.$`open ${appPath}`
            return { ok: true, action: "launched", path: appPath }
          }
          return { ok: false, error: "No .app found in archive" }
        }
      } else if (platform === "linux") {
        if (ext === "appimage") {
          const { chmod } = await import("fs/promises")
          await chmod(path, 0o755)
          return { ok: true, action: "ready", path }
        } else if (ext === "deb") {
          await Bun.$`sudo dpkg -i ${path}`.quiet()
          return { ok: true, action: "installed" }
        }
      } else if (platform === "win32") {
        if (ext === "exe" || ext === "msi") {
          await Bun.$`start ${path}`
          return { ok: true, action: "launched" }
        }
      }

      return { ok: false, error: `Unsupported update format: .${ext}` }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("updater:restart", async () => {
    try {
      const execPath = process.execPath
      const args = process.argv.slice(1)
      // Spawn new process and exit current
      Bun.spawn([execPath, ...args], { stdio: "inherit" })
      setTimeout(() => process.exit(0), 500)
      return { ok: true }
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
    },
    install: function (path) {
      return window.butter.invoke("updater:install", { path: path });
    },
    restart: function () {
      return window.butter.invoke("updater:restart");
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
