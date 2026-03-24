import { join, basename } from "path"
import { mkdir, symlink, chmod } from "fs/promises"
import { existsSync } from "fs"
import { platform } from "os"
import { loadConfig } from "../config"
import type { Config } from "../types"

// ── macOS ──────────────────────────────────────────────────────────────────

const generatePlist = (config: Config, executableName: string, hasIcon: boolean): string => {
  const identifier = config.bundle?.identifier ?? `com.example.${executableName}`
  const category = config.bundle?.category ?? "public.app-category.utilities"

  const iconEntry = hasIcon
    ? `\t<key>CFBundleIconFile</key>\n\t<string>icon</string>\n`
    : ""

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleName</key>
\t<string>${config.window.title}</string>
\t<key>CFBundleIdentifier</key>
\t<string>${identifier}</string>
\t<key>CFBundleExecutable</key>
\t<string>${executableName}</string>
\t<key>CFBundlePackageType</key>
\t<string>APPL</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleVersion</key>
\t<string>1.0.0</string>
\t<key>CFBundleShortVersionString</key>
\t<string>1.0.0</string>
\t<key>LSApplicationCategoryType</key>
\t<string>${category}</string>
${iconEntry}\t<key>NSHighResolutionCapable</key>
\t<true/>
</dict>
</plist>
`
}

export const bundleMacApp = async (
  binaryPath: string,
  config: Config,
  projectDir: string,
): Promise<string> => {
  const executableName = basename(binaryPath)
  const appName = config.window.title.replace(/[^a-zA-Z0-9 ]/g, "").trim() || executableName
  const appBundlePath = join(projectDir, "dist", `${appName}.app`)

  const macosDir = join(appBundlePath, "Contents", "MacOS")
  const resourcesDir = join(appBundlePath, "Contents", "Resources")

  await mkdir(macosDir, { recursive: true })
  await mkdir(resourcesDir, { recursive: true })

  // Copy binary into MacOS/
  const destBinary = join(macosDir, executableName)
  await Bun.write(destBinary, Bun.file(binaryPath))
  await chmod(destBinary, 0o755)

  // Copy icon if configured
  let hasIcon = false
  if (config.window.icon) {
    const iconSrc = join(projectDir, config.window.icon)
    if (existsSync(iconSrc)) {
      const ext = iconSrc.endsWith(".icns") ? ".icns" : ".png"
      await Bun.write(join(resourcesDir, `icon${ext}`), Bun.file(iconSrc))
      hasIcon = true
    }
  }

  // Write Info.plist
  const plist = generatePlist(config, executableName, hasIcon)
  await Bun.write(join(appBundlePath, "Contents", "Info.plist"), plist)

  return appBundlePath
}

// ── Linux AppImage (AppDir structure) ─────────────────────────────────────

const generateDesktopEntry = (config: Config, executableName: string, hasIcon: boolean): string => {
  const identifier = config.bundle?.identifier ?? `com.example.${executableName}`
  const category = config.bundle?.category ?? "Utility"
  const iconLine = hasIcon ? `Icon=${executableName}` : `Icon=application-default-icon`

  return `[Desktop Entry]
Type=Application
Name=${config.window.title}
Exec=${executableName}
${iconLine}
Categories=${category};
X-AppImage-Name=${config.window.title}
X-AppImage-Version=1.0.0
X-AppImage-Arch=x86_64
`
}

export const bundleLinuxAppDir = async (
  binaryPath: string,
  config: Config,
  projectDir: string,
): Promise<string> => {
  const executableName = basename(binaryPath)
  const appName = config.window.title.replace(/[^a-zA-Z0-9 ]/g, "").trim() || executableName
  const appDirPath = join(projectDir, "dist", `${appName}.AppDir`)

  const usrBinDir = join(appDirPath, "usr", "bin")
  await mkdir(usrBinDir, { recursive: true })

  // Copy binary to usr/bin/
  const destBinary = join(usrBinDir, executableName)
  await Bun.write(destBinary, Bun.file(binaryPath))
  await chmod(destBinary, 0o755)

  // AppRun symlink
  const appRunPath = join(appDirPath, "AppRun")
  if (!existsSync(appRunPath)) {
    await symlink(`usr/bin/${executableName}`, appRunPath)
  }

  // Copy icon if configured
  let hasIcon = false
  if (config.window.icon) {
    const iconSrc = join(projectDir, config.window.icon)
    if (existsSync(iconSrc)) {
      await Bun.write(join(appDirPath, "icon.png"), Bun.file(iconSrc))
      hasIcon = true
    }
  }

  // Write .desktop file
  const desktop = generateDesktopEntry(config, executableName, hasIcon)
  await Bun.write(join(appDirPath, `${executableName}.desktop`), desktop)

  return appDirPath
}

// ── bundle command entry point ─────────────────────────────────────────────

export const runBundle = async (projectDir: string): Promise<void> => {
  const config = await loadConfig(projectDir)
  const appName = config.window.title.toLowerCase().replace(/[^a-z0-9]/g, "") || basename(projectDir)
  const binaryPath = join(projectDir, "dist", appName)

  if (!existsSync(binaryPath)) {
    console.error(`Binary not found at ${binaryPath}. Run "butter compile" first.`)
    process.exit(1)
  }

  const os = platform()

  if (os === "darwin") {
    console.log(`\nBundling "${config.window.title}" for macOS...`)
    const appPath = await bundleMacApp(binaryPath, config, projectDir)
    console.log(`  Bundle: ${appPath}`)
  } else if (os === "linux") {
    console.log(`\nBundling "${config.window.title}" for Linux...`)
    const appDirPath = await bundleLinuxAppDir(binaryPath, config, projectDir)
    console.log(`  AppDir: ${appDirPath}`)
    console.log(`  To create a distributable .AppImage, run appimagetool on the AppDir above.`)
  } else {
    console.error(`Bundle is not yet supported on ${os}.`)
    process.exit(1)
  }
}
