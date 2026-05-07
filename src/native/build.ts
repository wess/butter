/*
 * Compiles C/Moxy native extensions and generates FFI bindings.
 *
 * Scans src/native/ for .c and .mxy files, extracts BUTTER_EXPORT blocks,
 * compiles to shared libraries, and generates TypeScript bindings.
 *
 * Build behaviour:
 *  - compile errors are FATAL by default; the build command's stderr is
 *    captured and printed, then the call throws.
 *  - set BUTTER_ALLOW_NATIVE_SKIP=1 to downgrade compile failures to a
 *    warning (the module is omitted from the returned list).
 *  - artifacts are cached on a fingerprint of (source bytes, compiler
 *    flags, host platform). A `.fp` file alongside the .dylib/.so/.dll
 *    holds the hash; matching fingerprint skips recompilation.
 */

import { join, basename, extname } from "path"
import { readdir } from "fs/promises"
import { extractExports, generateBindings } from "./parser"

const BUTTER_H_PATH = join(import.meta.dir, "butter.h")

const libExtension = (): string => {
  if (process.platform === "darwin") return "dylib"
  if (process.platform === "win32") return "dll"
  return "so"
}

const compilerCommand = (sourcePath: string, outputPath: string): { cmd: string[]; signature: string } => {
  const incFlag = `-I${import.meta.dir}`
  if (process.platform === "darwin") {
    const flags = ["-shared", "-fPIC", "-fvisibility=default", "-O2", incFlag]
    return {
      cmd: ["clang", ...flags, "-o", outputPath, sourcePath],
      signature: `clang ${flags.join(" ")} darwin`,
    }
  }
  if (process.platform === "win32") {
    const flags = ["/LD", "/O2", `/I${import.meta.dir}`]
    return {
      cmd: ["cl.exe", ...flags, `/Fe:${outputPath}`, sourcePath],
      signature: `cl.exe ${flags.join(" ")} win32`,
    }
  }
  const flags = ["-shared", "-fPIC", "-fvisibility=default", "-O2", incFlag]
  return {
    cmd: ["cc", ...flags, "-o", outputPath, sourcePath],
    signature: `cc ${flags.join(" ")} linux`,
  }
}

const runCompile = async (cmd: string[]): Promise<void> => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exit = await proc.exited
  if (exit !== 0) {
    const err = new Error(
      `Native compile failed (exit ${exit}):\n  $ ${cmd.join(" ")}\n${stderr || stdout}`,
    )
    throw err
  }
}

const compileC = async (sourcePath: string, outputPath: string): Promise<void> => {
  if (process.platform === "win32") {
    try {
      const { cmd } = compilerCommand(sourcePath, outputPath)
      await runCompile(cmd)
      return
    } catch {
      // fall through to gcc
      const fallbackFlags = ["-shared", "-fPIC", "-O2", `-I${import.meta.dir}`]
      await runCompile(["gcc", ...fallbackFlags, "-o", outputPath, sourcePath])
      return
    }
  }
  const { cmd } = compilerCommand(sourcePath, outputPath)
  await runCompile(cmd)
}

const compileMoxy = async (
  sourcePath: string,
  outputPath: string,
  buildDir: string,
): Promise<void> => {
  const { $ } = await import("bun")

  // Transpile .mxy to .c via moxy
  const cFile = join(buildDir, basename(sourcePath, ".mxy") + ".c")
  const transpiled = await $`moxy ${sourcePath}`.text()
  await Bun.write(cFile, transpiled)

  // Compile the generated C
  await compileC(cFile, outputPath)
}

const fingerprint = async (sourcePath: string, signature: string): Promise<string> => {
  const src = await Bun.file(sourcePath).arrayBuffer()
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(new Uint8Array(src))
  hasher.update(signature)
  hasher.update(process.platform)
  hasher.update(process.arch)
  return hasher.digest("hex")
}

const fingerprintPath = (libPath: string): string => libPath + ".fp"

const readFingerprint = async (libPath: string): Promise<string | null> => {
  const f = Bun.file(fingerprintPath(libPath))
  if (!(await f.exists())) return null
  return (await f.text()).trim()
}

export type NativeModule = {
  name: string
  sourcePath: string
  libPath: string
  bindingsPath: string
}

export const buildNativeExtensions = async (
  projectDir: string,
): Promise<NativeModule[]> => {
  const nativeDir = join(projectDir, "src", "native")
  const buildDir = join(projectDir, ".butter", "native")
  const modules: NativeModule[] = []

  // Check if src/native/ exists
  const entries = await readdir(nativeDir, { withFileTypes: true }).catch(() => [])
  if (entries.length === 0) return modules

  const { mkdir } = await import("fs/promises")
  await mkdir(buildDir, { recursive: true })

  // Copy butter.h into the native dir for includes
  const butterHDest = join(nativeDir, "butter.h")
  if (!(await Bun.file(butterHDest).exists())) {
    await Bun.write(butterHDest, Bun.file(BUTTER_H_PATH))
  }

  const allowSkip = process.env.BUTTER_ALLOW_NATIVE_SKIP === "1"

  for (const entry of entries) {
    if (entry.isDirectory()) continue

    const ext = extname(entry.name)
    if (ext !== ".c" && ext !== ".mxy") continue

    const name = basename(entry.name, ext)
    const sourcePath = join(nativeDir, entry.name)
    const libPath = join(buildDir, `${name}.${libExtension()}`)
    const bindingsPath = join(buildDir, `${name}.ts`)

    // Read source and extract exports
    const source = await Bun.file(sourcePath).text()
    const functions = extractExports(source)

    if (functions.length === 0) {
      console.warn(`  Warning: ${entry.name} has no BUTTER_EXPORT functions — skipping`)
      continue
    }

    const { signature } = compilerCommand(sourcePath, libPath)
    const expectedFp = await fingerprint(sourcePath, signature)
    const cachedFp = await readFingerprint(libPath)
    const lib = Bun.file(libPath)
    const needsBuild = cachedFp !== expectedFp || !(await lib.exists())

    if (needsBuild) {
      console.log(`  Compiling native module: ${entry.name}`)
      try {
        if (ext === ".mxy") {
          await compileMoxy(sourcePath, libPath, buildDir)
        } else {
          await compileC(sourcePath, libPath)
        }
        if (!(await Bun.file(libPath).exists())) {
          throw new Error(`compiler reported success but ${libPath} was not produced`)
        }
        await Bun.write(fingerprintPath(libPath), expectedFp)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (allowSkip) {
          console.warn(
            `  Warning: failed to build native module "${name}" — skipping (BUTTER_ALLOW_NATIVE_SKIP=1).`,
          )
          console.warn(`  ${msg}`)
          continue
        }
        throw new Error(
          `Failed to build native module "${name}". ${msg}\n` +
          `Set BUTTER_ALLOW_NATIVE_SKIP=1 to continue without it.`,
        )
      }
    } else {
      console.log(`  Native module up to date: ${entry.name}`)
    }

    // Generate bindings (cheap; always regenerate to track export edits)
    const bindings = generateBindings(name, functions)
    await Bun.write(bindingsPath, bindings)

    modules.push({ name, sourcePath, libPath, bindingsPath })
  }

  return modules
}
