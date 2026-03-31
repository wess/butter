import { platform } from "os"

export type StripResult = {
  before: number
  after: number
  saved: number
}

export const stripBinary = async (binaryPath: string): Promise<StripResult> => {
  const file = Bun.file(binaryPath)
  const before = file.size

  const os = platform()

  if (os === "darwin") {
    await Bun.$`strip -x ${binaryPath}`
  } else if (os === "linux") {
    await Bun.$`strip --strip-unneeded ${binaryPath}`
  } else if (os === "win32") {
    try {
      await Bun.$`strip --strip-unneeded ${binaryPath}`
    } catch {
      console.log("  Strip: no strip tool found, skipping.")
      return { before, after: before, saved: 0 }
    }
  } else {
    console.log("  Strip: unsupported platform, skipping.")
    return { before, after: before, saved: 0 }
  }

  const after = Bun.file(binaryPath).size
  const saved = before - after

  console.log(`  Strip: ${(before / 1024 / 1024).toFixed(1)} MB → ${(after / 1024 / 1024).toFixed(1)} MB (saved ${(saved / 1024).toFixed(0)} KB)`)

  return { before, after, saved }
}
