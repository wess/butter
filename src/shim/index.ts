import { $ } from "bun"
import { join, dirname } from "path"

export const shimSourcePath = (): string => {
  const platform = process.platform
  const file = platform === "darwin" ? "darwin.m" : platform === "linux" ? "linux.c" : "windows.c"
  return join(import.meta.dir, file)
}

export const shimBinaryPath = (projectDir: string): string =>
  join(projectDir, ".butter", "shim")

export const needsRecompile = async (
  binaryPath: string,
  sourcePath: string,
): Promise<boolean> => {
  const binary = Bun.file(binaryPath)
  if (!(await binary.exists())) return true

  const source = Bun.file(sourcePath)
  if (source.lastModified > binary.lastModified) return true

  // Also recompile if the Butter package version changed
  try {
    const versionFile = join(binaryPath + ".version")
    const vf = Bun.file(versionFile)
    const pkg = await import("../../package.json")
    const currentVersion = pkg.default?.version ?? pkg.version ?? ""
    if (!(await vf.exists())) return true
    const cachedVersion = await vf.text()
    return cachedVersion.trim() !== currentVersion
  } catch {
    return true
  }
}

export const compileShim = async (projectDir: string): Promise<string> => {
  const source = shimSourcePath()
  const output = shimBinaryPath(projectDir)
  const outputDir = dirname(output)

  await $`mkdir -p ${outputDir}`

  if (process.platform === "darwin") {
    await $`clang -o ${output} ${source} -framework Cocoa -framework WebKit -framework UniformTypeIdentifiers -fobjc-arc`
  } else if (process.platform === "linux") {
    const cflags = await $`pkg-config --cflags gtk+-3.0 webkit2gtk-4.1`.text()
    const libs = await $`pkg-config --libs gtk+-3.0 webkit2gtk-4.1`.text()
    await $`tcc -o ${output} ${source} ${cflags.trim().split(" ")} ${libs.trim().split(" ")}`
  }

  // Stamp version so we know when to recompile after package updates
  try {
    const pkg = await import("../../package.json")
    const version = pkg.default?.version ?? pkg.version ?? ""
    await Bun.write(output + ".version", version)
  } catch { /* non-critical */ }

  return output
}

export const spawnShim = async (
  binaryPath: string,
  shmName: string,
  htmlPath: string,
  env?: Record<string, string>,
): Promise<ReturnType<typeof Bun.spawn>> => {
  // macOS uses argv[0] as the app name in the menu bar.
  // Create a symlink named after the app title so the menu shows the right name.
  const appName = env?.BUTTER_TITLE ?? "Butter App"
  const safeName = appName.replace(/[^a-zA-Z0-9 ]/g, "")
  const linkPath = join(dirname(binaryPath), safeName)

  try {
    await $`ln -sf ${binaryPath} ${linkPath}`.quiet()
  } catch {
    // Fall back to the raw binary path
    return Bun.spawn([binaryPath, shmName, htmlPath], {
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env, ...env },
    })
  }

  return Bun.spawn([linkPath, shmName, htmlPath], {
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, ...env },
  })
}
