/*
 * Compiles C/Moxy native extensions and generates FFI bindings.
 *
 * Scans src/native/ for .c and .mxy files, extracts BUTTER_EXPORT blocks,
 * compiles to shared libraries, and generates TypeScript bindings.
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

const compileC = async (
  sourcePath: string,
  outputPath: string,
): Promise<void> => {
  const { $ } = await import("bun")

  if (process.platform === "darwin") {
    await $`clang -shared -fPIC -fvisibility=default -O2 -I${import.meta.dir} -o ${outputPath} ${sourcePath}`.quiet()
  } else if (process.platform === "win32") {
    try {
      await $`cl.exe /LD /O2 /I${import.meta.dir} /Fe:${outputPath} ${sourcePath}`.quiet()
    } catch {
      await $`gcc -shared -fPIC -O2 -I${import.meta.dir} -o ${outputPath} ${sourcePath}`.quiet()
    }
  } else {
    await $`cc -shared -fPIC -fvisibility=default -O2 -I${import.meta.dir} -o ${outputPath} ${sourcePath}`.quiet()
  }
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

    // Check if recompilation needed
    const lib = Bun.file(libPath)
    const src = Bun.file(sourcePath)
    const needsBuild = !(await lib.exists()) || src.lastModified > lib.lastModified

    if (needsBuild) {
      console.log(`  Compiling native module: ${entry.name}`)
      if (ext === ".mxy") {
        await compileMoxy(sourcePath, libPath, buildDir)
      } else {
        await compileC(sourcePath, libPath)
      }
    }

    // Generate bindings
    const bindings = generateBindings(name, functions)
    await Bun.write(bindingsPath, bindings)

    modules.push({ name, sourcePath, libPath, bindingsPath })
  }

  return modules
}
