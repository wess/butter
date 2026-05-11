/*
 * Compiles native extensions and generates FFI bindings.
 *
 * Languages:
 *   .c    — clang / cc / cl.exe (gcc fallback on Windows)
 *   .mxy  — moxy transpile → .c → C compiler
 *   .rs   — rustc --crate-type cdylib   (single-file)
 *   .zig  — zig build-lib -dynamic
 *   <dir>/Cargo.toml — cargo build --release (multi-file Rust)
 *
 * For all four languages the output is a platform shared library
 * (.dylib/.so/.dll) with C-ABI symbols loaded by bun:ffi. Function signatures
 * come from BUTTER_EXPORT(...) blocks (C) or // @butter-export annotations
 * (Moxy/Rust/Zig); see src/native/parser.ts.
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
import { extractExports, extractRustExports, extractZigExports, generateBindings } from "./parser"
import type { FfiFunction } from "./parser"

const BUTTER_H_PATH = join(import.meta.dir, "butter.h")

const libExtension = (): string => {
  if (process.platform === "darwin") return "dylib"
  if (process.platform === "win32") return "dll"
  return "so"
}

const cCompilerCommand = (sourcePath: string, outputPath: string): { cmd: string[]; signature: string } => {
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

const rustcCommand = (sourcePath: string, outputPath: string): { cmd: string[]; signature: string } => {
  const flags = ["--crate-type", "cdylib", "--edition", "2021", "-C", "opt-level=3"]
  return {
    cmd: ["rustc", ...flags, "-o", outputPath, sourcePath],
    signature: `rustc ${flags.join(" ")} ${process.platform}`,
  }
}

const zigCommand = (sourcePath: string, outputPath: string): { cmd: string[]; signature: string } => {
  // -femit-bin pins the output path; without it Zig writes lib<name>.<ext>
  // into the current working directory.
  const flags = ["build-lib", "-dynamic", "-OReleaseFast"]
  return {
    cmd: ["zig", ...flags, `-femit-bin=${outputPath}`, sourcePath],
    signature: `zig ${flags.join(" ")} ${process.platform}`,
  }
}

const cargoSignature = `cargo build --release ${process.platform} ${process.arch}`

const runCompile = async (cmd: string[], cwd?: string): Promise<void> => {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exit = await proc.exited
  if (exit !== 0) {
    throw new Error(
      `Native compile failed (exit ${exit}):\n  $ ${cmd.join(" ")}\n${stderr || stdout}`,
    )
  }
}

const compileC = async (sourcePath: string, outputPath: string): Promise<void> => {
  if (process.platform === "win32") {
    try {
      await runCompile(cCompilerCommand(sourcePath, outputPath).cmd)
      return
    } catch {
      const fallbackFlags = ["-shared", "-fPIC", "-O2", `-I${import.meta.dir}`]
      await runCompile(["gcc", ...fallbackFlags, "-o", outputPath, sourcePath])
      return
    }
  }
  await runCompile(cCompilerCommand(sourcePath, outputPath).cmd)
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

  await compileC(cFile, outputPath)
}

const compileRust = async (sourcePath: string, outputPath: string): Promise<void> => {
  await runCompile(rustcCommand(sourcePath, outputPath).cmd)
}

const compileZig = async (sourcePath: string, outputPath: string): Promise<void> => {
  await runCompile(zigCommand(sourcePath, outputPath).cmd)
}

// Cargo converts hyphens in the package name to underscores for the cdylib
// filename (e.g. "my-hash" → "libmy_hash.dylib"), so we mirror that. [lib].name
// wins over [package].name when both are set; this matches cargo's own rules.
const cargoLibName = async (cargoTomlPath: string): Promise<string> => {
  const text = await Bun.file(cargoTomlPath).text()
  let section = ""
  let libName: string | null = null
  let pkgName: string | null = null
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    const sec = line.match(/^\[([\w.-]+)\]/)
    if (sec) { section = sec[1]; continue }
    const kv = line.match(/^name\s*=\s*"([^"]+)"/)
    if (!kv) continue
    if (section === "lib" && libName === null) libName = kv[1]
    else if (section === "package" && pkgName === null) pkgName = kv[1]
  }
  const name = libName ?? pkgName
  if (!name) throw new Error(`Cannot find name in ${cargoTomlPath}`)
  return name.replace(/-/g, "_")
}

const cargoArtifactPath = (projectDir: string, libName: string): string => {
  const ext = libExtension()
  // Cargo prefixes Unix shared libs with "lib"; Windows DLLs are bare.
  const filename = process.platform === "win32" ? `${libName}.${ext}` : `lib${libName}.${ext}`
  return join(projectDir, "target", "release", filename)
}

const buildCargoProject = async (
  projectDir: string,
  outputPath: string,
): Promise<{ libName: string; sourceFiles: string[] }> => {
  const libName = await cargoLibName(join(projectDir, "Cargo.toml"))
  await runCompile(["cargo", "build", "--release"], projectDir)
  const compiled = cargoArtifactPath(projectDir, libName)
  if (!(await Bun.file(compiled).exists())) {
    throw new Error(
      `cargo reported success but ${compiled} was not produced. ` +
      `Make sure Cargo.toml declares crate-type = ["cdylib"].`,
    )
  }
  await Bun.write(outputPath, Bun.file(compiled))
  const sourceFiles = await walkRustSources(projectDir)
  return { libName, sourceFiles }
}

const walkRustSources = async (projectDir: string): Promise<string[]> => {
  const collected: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      // `target/` is cargo's build output; skipping it avoids re-fingerprinting
      // megabytes of intermediates on every build.
      if (e.isDirectory()) {
        if (e.name === "target" || e.name === ".git") continue
        await walk(join(dir, e.name))
      } else if (e.name.endsWith(".rs")) {
        collected.push(join(dir, e.name))
      }
    }
  }
  await walk(projectDir)
  return collected.sort()
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

const fingerprintMany = async (paths: string[], extra: string[], signature: string): Promise<string> => {
  const hasher = new Bun.CryptoHasher("sha256")
  for (const p of paths) {
    hasher.update(p)
    hasher.update(new Uint8Array(await Bun.file(p).arrayBuffer()))
  }
  for (const extraPath of extra) {
    hasher.update(extraPath)
    hasher.update(new Uint8Array(await Bun.file(extraPath).arrayBuffer()))
  }
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

type FilePlan =
  | { kind: "file"; name: string; sourcePath: string; ext: ".c" | ".mxy" | ".rs" | ".zig" }
  | { kind: "cargo"; name: string; projectDir: string }

const collectExports = async (plan: FilePlan): Promise<FfiFunction[]> => {
  if (plan.kind === "file") {
    const source = await Bun.file(plan.sourcePath).text()
    if (plan.ext === ".c" || plan.ext === ".mxy") return extractExports(source)
    if (plan.ext === ".rs") return extractRustExports(source)
    return extractZigExports(source)
  }
  const sources = await walkRustSources(plan.projectDir)
  const all: FfiFunction[] = []
  for (const f of sources) {
    const source = await Bun.file(f).text()
    all.push(...extractRustExports(source))
  }
  return all
}

const planSignature = (plan: FilePlan, libPath: string): string => {
  if (plan.kind === "cargo") return cargoSignature
  if (plan.ext === ".rs") return rustcCommand(plan.sourcePath, libPath).signature
  if (plan.ext === ".zig") return zigCommand(plan.sourcePath, libPath).signature
  return cCompilerCommand(plan.sourcePath, libPath).signature
}

const buildOne = async (plan: FilePlan, libPath: string, buildDir: string): Promise<void> => {
  if (plan.kind === "cargo") {
    await buildCargoProject(plan.projectDir, libPath)
    return
  }
  switch (plan.ext) {
    case ".c": return compileC(plan.sourcePath, libPath)
    case ".mxy": return compileMoxy(plan.sourcePath, libPath, buildDir)
    case ".rs": return compileRust(plan.sourcePath, libPath)
    case ".zig": return compileZig(plan.sourcePath, libPath)
  }
}

const computeFingerprint = async (plan: FilePlan, signature: string): Promise<string> => {
  if (plan.kind === "file") return fingerprint(plan.sourcePath, signature)
  const sources = await walkRustSources(plan.projectDir)
  return fingerprintMany(sources, [join(plan.projectDir, "Cargo.toml")], signature)
}

export const buildNativeExtensions = async (
  projectDir: string,
): Promise<NativeModule[]> => {
  const nativeDir = join(projectDir, "src", "native")
  const buildDir = join(projectDir, ".butter", "native")
  const modules: NativeModule[] = []

  const entries = await readdir(nativeDir, { withFileTypes: true }).catch(() => [])
  if (entries.length === 0) return modules

  const { mkdir } = await import("fs/promises")
  await mkdir(buildDir, { recursive: true })

  // Copy butter.h alongside the user's sources so #include "butter.h" works
  // from C and Moxy. Rust and Zig don't need it but the copy is harmless.
  const butterHDest = join(nativeDir, "butter.h")
  if (!(await Bun.file(butterHDest).exists())) {
    await Bun.write(butterHDest, Bun.file(BUTTER_H_PATH))
  }

  const allowSkip = process.env.BUTTER_ALLOW_NATIVE_SKIP === "1"

  // Build the list of compile plans first so each plan type (file/cargo) is
  // handled uniformly below.
  const plans: FilePlan[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const cargoToml = join(nativeDir, entry.name, "Cargo.toml")
      if (await Bun.file(cargoToml).exists()) {
        plans.push({ kind: "cargo", name: entry.name, projectDir: join(nativeDir, entry.name) })
      }
      continue
    }
    const ext = extname(entry.name)
    if (ext !== ".c" && ext !== ".mxy" && ext !== ".rs" && ext !== ".zig") continue
    plans.push({
      kind: "file",
      name: basename(entry.name, ext),
      sourcePath: join(nativeDir, entry.name),
      ext,
    })
  }

  for (const plan of plans) {
    const libPath = join(buildDir, `${plan.name}.${libExtension()}`)
    const bindingsPath = join(buildDir, `${plan.name}.ts`)

    const functions = await collectExports(plan)
    if (functions.length === 0) {
      const label = plan.kind === "cargo" ? `cargo project "${plan.name}"` : basename(plan.sourcePath)
      console.warn(`  Warning: ${label} has no exported functions — skipping`)
      continue
    }

    const signature = planSignature(plan, libPath)
    const expectedFp = await computeFingerprint(plan, signature)
    const cachedFp = await readFingerprint(libPath)
    const lib = Bun.file(libPath)
    const needsBuild = cachedFp !== expectedFp || !(await lib.exists())

    if (needsBuild) {
      const label = plan.kind === "cargo" ? `${plan.name} (cargo)` : basename(plan.sourcePath)
      console.log(`  Compiling native module: ${label}`)
      try {
        await buildOne(plan, libPath, buildDir)
        if (!(await Bun.file(libPath).exists())) {
          throw new Error(`compiler reported success but ${libPath} was not produced`)
        }
        await Bun.write(fingerprintPath(libPath), expectedFp)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (allowSkip) {
          console.warn(
            `  Warning: failed to build native module "${plan.name}" — skipping (BUTTER_ALLOW_NATIVE_SKIP=1).`,
          )
          console.warn(`  ${msg}`)
          continue
        }
        throw new Error(
          `Failed to build native module "${plan.name}". ${msg}\n` +
          `Set BUTTER_ALLOW_NATIVE_SKIP=1 to continue without it.`,
        )
      }
    } else {
      const label = plan.kind === "cargo" ? `${plan.name} (cargo)` : basename(plan.sourcePath)
      console.log(`  Native module up to date: ${label}`)
    }

    const bindings = generateBindings(plan.name, functions)
    await Bun.write(bindingsPath, bindings)

    modules.push({
      name: plan.name,
      sourcePath: plan.kind === "cargo" ? plan.projectDir : plan.sourcePath,
      libPath,
      bindingsPath,
    })
  }

  return modules
}
