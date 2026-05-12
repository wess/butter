import type { Plugin, HostContext } from "../../types"
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

// Register/unregister the current executable for system startup. Cross-platform:
//   macOS  — ~/Library/LaunchAgents/<id>.plist + launchctl load
//   Linux  — ~/.config/autostart/<id>.desktop
//   Win32  — HKCU\Software\Microsoft\Windows\CurrentVersion\Run\<id>

type EnableParams = { args?: string[] }

const SAFE_ID = /^[a-zA-Z0-9._-]+$/

const appId = (): string => {
  const id = (process.env.BUTTER_APP_ID || process.env.BUTTER_TITLE || "butterapp")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
  if (!SAFE_ID.test(id)) throw new Error("invalid app id")
  return id
}

const exePath = (): string => process.env.BUTTER_EXE || process.execPath

const macPlistPath = (): string => join(homedir(), "Library", "LaunchAgents", `${appId()}.plist`)

const linuxDesktopPath = (): string =>
  join(homedir(), ".config", "autostart", `${appId()}.desktop`)

const macPlist = (exe: string, args: string[]): string => {
  const argLines = [exe, ...args]
    .map((a) => `    <string>${a.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string>`)
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${appId()}</string>
  <key>ProgramArguments</key>
  <array>
${argLines}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
`
}

const linuxDesktop = (exe: string, args: string[]): string => {
  const cmd = [exe, ...args].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")
  return `[Desktop Entry]
Type=Application
Name=${process.env.BUTTER_TITLE ?? appId()}
Exec=${cmd}
X-GNOME-Autostart-enabled=true
Hidden=false
`
}

const enable = async (args: string[] = []): Promise<{ ok: boolean; error?: string }> => {
  try {
    const exe = exePath()
    if (process.platform === "darwin") {
      const path = macPlistPath()
      mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true })
      writeFileSync(path, macPlist(exe, args))
      try {
        await Bun.$`launchctl unload ${path}`.quiet()
      } catch { /* not loaded yet */ }
      await Bun.$`launchctl load ${path}`.quiet()
      return { ok: true }
    }
    if (process.platform === "linux") {
      const path = linuxDesktopPath()
      mkdirSync(join(homedir(), ".config", "autostart"), { recursive: true })
      writeFileSync(path, linuxDesktop(exe, args))
      return { ok: true }
    }
    if (process.platform === "win32") {
      const id = appId()
      const value = [exe, ...args].map((a) => `"${a.replace(/"/g, '""')}"`).join(" ")
      await Bun.$`reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v ${id} /t REG_SZ /d ${value} /f`.quiet()
      return { ok: true }
    }
    return { ok: false, error: `unsupported platform: ${process.platform}` }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

const disable = async (): Promise<{ ok: boolean; error?: string }> => {
  try {
    if (process.platform === "darwin") {
      const path = macPlistPath()
      if (existsSync(path)) {
        try { await Bun.$`launchctl unload ${path}`.quiet() } catch { /* may not be loaded */ }
        unlinkSync(path)
      }
      return { ok: true }
    }
    if (process.platform === "linux") {
      const path = linuxDesktopPath()
      if (existsSync(path)) unlinkSync(path)
      return { ok: true }
    }
    if (process.platform === "win32") {
      const id = appId()
      try {
        await Bun.$`reg delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v ${id} /f`.quiet()
      } catch { /* key may not exist */ }
      return { ok: true }
    }
    return { ok: false, error: `unsupported platform: ${process.platform}` }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

const isEnabled = async (): Promise<{ ok: boolean; enabled: boolean }> => {
  try {
    if (process.platform === "darwin") return { ok: true, enabled: existsSync(macPlistPath()) }
    if (process.platform === "linux") return { ok: true, enabled: existsSync(linuxDesktopPath()) }
    if (process.platform === "win32") {
      const id = appId()
      try {
        const out = await Bun.$`reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v ${id}`.text()
        return { ok: true, enabled: out.includes(id) }
      } catch {
        return { ok: true, enabled: false }
      }
    }
    return { ok: false, enabled: false }
  } catch {
    return { ok: false, enabled: false }
  }
}

const host = (ctx: HostContext): void => {
  ctx.on("autolaunch:enable", async (data: unknown) => {
    const { args } = (data ?? {}) as EnableParams
    return enable(Array.isArray(args) ? args : [])
  })
  ctx.on("autolaunch:disable", async () => disable())
  ctx.on("autolaunch:status", async () => isEnabled())
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.autoLaunch = {
    enable: function (args) { return window.butter.invoke("autolaunch:enable", { args: args || [] }); },
    disable: function () { return window.butter.invoke("autolaunch:disable"); },
    isEnabled: function () { return window.butter.invoke("autolaunch:status"); }
  };
})();
`

const autolaunch: Plugin = {
  name: "autolaunch",
  host,
  webview,
}

export default autolaunch
