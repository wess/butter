import { platform } from "os"

export type TargetPlatform = "darwin" | "linux" | "windows"

const VALID_TARGETS: TargetPlatform[] = ["darwin", "linux", "windows"]

export const parseTarget = (args: string[]): TargetPlatform | undefined => {
  const idx = args.indexOf("--target")
  if (idx === -1) return undefined
  const value = args[idx + 1]
  if (!value) {
    console.error("--target requires a value: darwin | linux | windows")
    process.exit(1)
  }
  if (!VALID_TARGETS.includes(value as TargetPlatform)) {
    console.error(`Unknown target "${value}". Valid targets: ${VALID_TARGETS.join(", ")}`)
    process.exit(1)
  }
  return value as TargetPlatform
}

export const currentPlatform = (): TargetPlatform => {
  const os = platform()
  if (os === "darwin") return "darwin"
  if (os === "linux") return "linux"
  if (os === "win32") return "windows"
  return "linux"
}

export const assertNativePlatform = (target: TargetPlatform): void => {
  const current = currentPlatform()
  if (target === current) return

  const guidance: Record<TargetPlatform, string> = {
    darwin: "compile on macOS",
    linux: "compile on Linux or use Docker (e.g. docker run --rm -v $PWD:/app oven/bun bun run butter compile)",
    windows: "compile on Windows or use a Windows VM/CI runner",
  }

  console.error(
    `Cross-compilation requires the target platform's SDK.\n` +
    `For ${target} targets, ${guidance[target]}.\n` +
    `\n` +
    `Butter embeds native WebView libraries and C shim code that must be compiled\n` +
    `on the target OS. Cross-compilation support is planned for a future release.`
  )
  process.exit(1)
}
