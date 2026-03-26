import { join, basename } from "path"
import { existsSync } from "fs"
import { platform } from "os"
import { loadConfig } from "../config"

type SignOptions = {
  identity?: string
  entitlements?: string
  notarize?: boolean
  appleId?: string
  teamId?: string
  password?: string
  pfx?: string
  pfxPassword?: string
}

const parseArgs = (args: string[]): SignOptions => {
  const opts: SignOptions = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]
    if (arg === "--identity" && next) { opts.identity = next; i++ }
    else if (arg === "--entitlements" && next) { opts.entitlements = next; i++ }
    else if (arg === "--notarize") { opts.notarize = true }
    else if (arg === "--apple-id" && next) { opts.appleId = next; i++ }
    else if (arg === "--team-id" && next) { opts.teamId = next; i++ }
    else if (arg === "--password" && next) { opts.password = next; i++ }
    else if (arg === "--pfx" && next) { opts.pfx = next; i++ }
    else if (arg === "--pfx-password" && next) { opts.pfxPassword = next; i++ }
  }
  return opts
}

const signMacOS = async (appPath: string, opts: SignOptions): Promise<void> => {
  const identity = opts.identity ?? "-"

  console.log(`Signing ${appPath} with identity "${identity}"...`)

  const codesignArgs = ["--force", "--deep", "--sign", identity]

  if (opts.entitlements) {
    codesignArgs.push("--entitlements", opts.entitlements)
  }

  codesignArgs.push("--options", "runtime")
  codesignArgs.push(appPath)

  const result = await Bun.$`codesign ${codesignArgs}`.quiet()
  if (result.exitCode !== 0) {
    throw new Error(`codesign failed: ${result.stderr.toString()}`)
  }
  console.log("  Signed successfully.")

  // Verify
  const verify = await Bun.$`codesign --verify --deep --strict ${appPath}`.quiet()
  if (verify.exitCode === 0) {
    console.log("  Verification passed.")
  }

  // Notarize if requested
  if (opts.notarize) {
    const appleId = opts.appleId ?? process.env.APPLE_ID
    const teamId = opts.teamId ?? process.env.APPLE_TEAM_ID
    const password = opts.password ?? process.env.APPLE_APP_PASSWORD

    if (!appleId || !teamId || !password) {
      console.error("  Notarization requires --apple-id, --team-id, and --password (or env vars)")
      return
    }

    console.log("  Submitting for notarization...")

    // Create zip for notarization
    const zipPath = `${appPath}.zip`
    await Bun.$`ditto -c -k --keepParent ${appPath} ${zipPath}`.quiet()

    const notarize = await Bun.$`xcrun notarytool submit ${zipPath} --apple-id ${appleId} --team-id ${teamId} --password ${password} --wait`.quiet()

    if (notarize.exitCode === 0) {
      console.log("  Notarization succeeded.")

      // Staple the ticket
      await Bun.$`xcrun stapler staple ${appPath}`.quiet()
      console.log("  Ticket stapled.")
    } else {
      console.error(`  Notarization failed: ${notarize.stderr.toString()}`)
    }

    // Clean up zip
    await Bun.$`rm -f ${zipPath}`.quiet()
  }
}

const signWindows = async (binaryPath: string, opts: SignOptions): Promise<void> => {
  console.log(`Signing ${binaryPath}...`)

  if (opts.pfx) {
    const args = ["sign", "/f", opts.pfx, "/fd", "SHA256", "/tr", "http://timestamp.digicert.com", "/td", "SHA256"]
    if (opts.pfxPassword) {
      args.push("/p", opts.pfxPassword)
    }
    args.push(binaryPath)

    const result = await Bun.$`signtool ${args}`.quiet()
    if (result.exitCode !== 0) {
      throw new Error(`signtool failed: ${result.stderr.toString()}`)
    }
    console.log("  Signed successfully.")
  } else {
    console.error("  Windows signing requires --pfx <certificate.pfx>")
  }
}

const signLinux = async (binaryPath: string, opts: SignOptions): Promise<void> => {
  console.log(`Signing ${binaryPath} with GPG...`)

  const identity = opts.identity
  const gpgArgs = identity
    ? ["--detach-sign", "--armor", "-u", identity, binaryPath]
    : ["--detach-sign", "--armor", binaryPath]

  const result = await Bun.$`gpg ${gpgArgs}`.quiet()
  if (result.exitCode !== 0) {
    throw new Error(`gpg sign failed: ${result.stderr.toString()}`)
  }
  console.log(`  Signature: ${binaryPath}.asc`)
}

export const runSign = async (projectDir: string, args: string[]): Promise<void> => {
  const config = await loadConfig(projectDir)
  const opts = parseArgs(args)
  const os = platform()
  const appName = config.window.title.replace(/[^a-zA-Z0-9 ]/g, "").trim()

  if (os === "darwin") {
    // Try .app bundle first, then binary
    const appPath = join(projectDir, "dist", `${appName}.app`)
    const binaryName = appName.toLowerCase().replace(/[^a-z0-9]/g, "") || basename(projectDir)
    const binaryPath = join(projectDir, "dist", binaryName)

    if (existsSync(appPath)) {
      await signMacOS(appPath, opts)
    } else if (existsSync(binaryPath)) {
      await signMacOS(binaryPath, opts)
    } else {
      console.error(`No app bundle or binary found in dist/. Run "butter compile" and "butter bundle" first.`)
      process.exit(1)
    }
  } else if (os === "win32") {
    const binaryName = (appName.toLowerCase().replace(/[^a-z0-9]/g, "") || basename(projectDir)) + ".exe"
    const binaryPath = join(projectDir, "dist", binaryName)
    if (!existsSync(binaryPath)) {
      console.error(`Binary not found: ${binaryPath}`)
      process.exit(1)
    }
    await signWindows(binaryPath, opts)
  } else if (os === "linux") {
    const binaryName = appName.toLowerCase().replace(/[^a-z0-9]/g, "") || basename(projectDir)
    const binaryPath = join(projectDir, "dist", binaryName)
    if (!existsSync(binaryPath)) {
      console.error(`Binary not found: ${binaryPath}`)
      process.exit(1)
    }
    await signLinux(binaryPath, opts)
  } else {
    console.error(`Code signing not supported on ${os}`)
    process.exit(1)
  }
}
