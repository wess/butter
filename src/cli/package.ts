import { join, basename, dirname } from "path"
import { existsSync, mkdirSync, chmodSync } from "fs"
import { platform } from "os"
import { loadConfig } from "../config"
import type { Config } from "../types"

// `butter package` turns a bundled app into a distributable installer.
//   macOS  — DMG via hdiutil  (no third-party tooling required)
//   Linux  — AppImage via appimagetool (downloaded into .butter/tools on demand)
//   Win32  — NSIS .exe if makensis is installed, otherwise a portable .zip

const distAppName = (config: Config): string =>
  config.window.title.replace(/[^a-zA-Z0-9 ]/g, "").trim() ||
  config.window.title.toLowerCase().replace(/[^a-z0-9]/g, "")

const ensureDir = (dir: string): void => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// ── macOS DMG ─────────────────────────────────────────────────────────────

const packageMacDmg = async (config: Config, projectDir: string): Promise<string> => {
  const appName = distAppName(config)
  const appPath = join(projectDir, "dist", `${appName}.app`)
  if (!existsSync(appPath)) {
    throw new Error(`No .app at ${appPath} — run "butter bundle" first.`)
  }
  const dmgPath = join(projectDir, "dist", `${appName}.dmg`)
  if (existsSync(dmgPath)) {
    const { unlinkSync } = await import("fs")
    unlinkSync(dmgPath)
  }
  // Stage a layout dir so the DMG contains <App>.app + an Applications symlink.
  const stage = join(projectDir, ".butter", "dmgstage")
  await Bun.$`rm -rf ${stage}`.quiet()
  ensureDir(stage)
  await Bun.$`cp -R ${appPath} ${stage}/`
  await Bun.$`ln -s /Applications ${stage}/Applications`.quiet()
  await Bun.$`hdiutil create -volname ${appName} -srcfolder ${stage} -ov -format UDZO ${dmgPath}`
  await Bun.$`rm -rf ${stage}`.quiet()
  return dmgPath
}

// ── Linux AppImage ────────────────────────────────────────────────────────

const APPIMAGETOOL_URL =
  "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"

const ensureAppImageTool = async (projectDir: string): Promise<string> => {
  const toolDir = join(projectDir, ".butter", "tools")
  ensureDir(toolDir)
  const toolPath = join(toolDir, "appimagetool")
  if (existsSync(toolPath)) return toolPath
  console.log("  Downloading appimagetool...")
  const res = await fetch(APPIMAGETOOL_URL)
  if (!res.ok) throw new Error(`appimagetool download failed: ${res.status}`)
  await Bun.write(toolPath, res)
  chmodSync(toolPath, 0o755)
  return toolPath
}

const packageLinuxAppImage = async (config: Config, projectDir: string): Promise<string> => {
  const appName = distAppName(config)
  const appDir = join(projectDir, "dist", `${appName}.AppDir`)
  if (!existsSync(appDir)) {
    throw new Error(`No AppDir at ${appDir} — run "butter bundle" first.`)
  }
  const outPath = join(projectDir, "dist", `${appName}-x86_64.AppImage`)
  const tool = await ensureAppImageTool(projectDir)
  // ARCH env is required by appimagetool for reproducible naming.
  await Bun.$`ARCH=x86_64 ${tool} ${appDir} ${outPath}`
  chmodSync(outPath, 0o755)
  return outPath
}

// ── Windows installer / portable zip ──────────────────────────────────────

const nsisTemplate = (appName: string, exeName: string, identifier: string): string => `
!define APP_NAME "${appName}"
!define APP_ID "${identifier}"
!define EXE_NAME "${exeName}"

Name "\${APP_NAME}"
OutFile "${appName}-setup.exe"
InstallDir "$PROGRAMFILES\\\${APP_NAME}"
InstallDirRegKey HKLM "Software\\\${APP_ID}" "InstallDir"
RequestExecutionLevel admin
ShowInstDetails show

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${appName}\\*.*"
  WriteUninstaller "$INSTDIR\\uninstall.exe"
  WriteRegStr HKLM "Software\\\${APP_ID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\${APP_ID}" "DisplayName" "\${APP_NAME}"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\${APP_ID}" "UninstallString" "$INSTDIR\\uninstall.exe"
  CreateShortcut "$DESKTOP\\\${APP_NAME}.lnk" "$INSTDIR\\\${EXE_NAME}"
  CreateDirectory "$SMPROGRAMS\\\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\\\${APP_NAME}\\\${APP_NAME}.lnk" "$INSTDIR\\\${EXE_NAME}"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\\\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\\\${APP_NAME}\\\${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\\\${APP_NAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "Software\\\${APP_ID}"
  DeleteRegKey HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\${APP_ID}"
SectionEnd
`

const hasMakensis = async (): Promise<boolean> => {
  try {
    await Bun.$`makensis /VERSION`.quiet()
    return true
  } catch {
    return false
  }
}

const packageWindowsZip = async (config: Config, projectDir: string): Promise<string> => {
  const appName = distAppName(config)
  const bundlePath = join(projectDir, "dist", appName)
  if (!existsSync(bundlePath)) {
    throw new Error(`No bundle at ${bundlePath} — run "butter bundle" first.`)
  }
  const zipPath = join(projectDir, "dist", `${appName}.zip`)
  // Use PowerShell's Compress-Archive — available on every modern Windows.
  await Bun.$`powershell -Command "Compress-Archive -Path '${bundlePath}/*' -DestinationPath '${zipPath}' -Force"`
  return zipPath
}

const packageWindowsNsis = async (config: Config, projectDir: string): Promise<string> => {
  const appName = distAppName(config)
  const bundlePath = join(projectDir, "dist", appName)
  const exeName = `${appName.toLowerCase().replace(/[^a-z0-9]/g, "")}.exe`
  const identifier = config.bundle?.identifier ?? `com.example.${exeName}`
  const nsiPath = join(projectDir, "dist", "installer.nsi")
  await Bun.write(nsiPath, nsisTemplate(appName, exeName, identifier))
  await Bun.$`makensis ${nsiPath}`
  const out = join(projectDir, "dist", `${appName}-setup.exe`)
  return out
}

// ── command entry point ───────────────────────────────────────────────────

export const runPackage = async (projectDir: string): Promise<void> => {
  const config = await loadConfig(projectDir)
  const os = platform()
  console.log(`\nPackaging "${config.window.title}" for ${os}...`)

  if (os === "darwin") {
    const out = await packageMacDmg(config, projectDir)
    console.log(`  DMG: ${out}`)
    return
  }
  if (os === "linux") {
    const out = await packageLinuxAppImage(config, projectDir)
    console.log(`  AppImage: ${out}`)
    return
  }
  if (os === "win32") {
    if (await hasMakensis()) {
      const out = await packageWindowsNsis(config, projectDir)
      console.log(`  Installer: ${out}`)
    } else {
      console.log("  makensis not found — falling back to portable .zip")
      const out = await packageWindowsZip(config, projectDir)
      console.log(`  Portable: ${out}`)
    }
    return
  }
  throw new Error(`Packaging is not supported on ${os}.`)
}
