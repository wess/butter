/*
 * Native extension loader for Butter apps.
 *
 * Usage:
 *   import { native } from "butter/native"
 *   const crypto = await native("crypto")
 *   const hash = crypto.fast_hash("hello", 5)
 *
 * Or with explicit types:
 *   import { native } from "butter/native"
 *   type CryptoNative = { fast_hash: (input: string, len: number) => number }
 *   const crypto = await native<CryptoNative>("crypto")
 */

import { join } from "path"

export const native = async <T = Record<string, (...args: unknown[]) => unknown>>(
  moduleName: string,
): Promise<T> => {
  // Look for the compiled bindings in .butter/native/
  const cwd = process.cwd()
  const bindingsPath = join(cwd, ".butter", "native", `${moduleName}.ts`)
  const libPath = join(cwd, ".butter", "native", `${moduleName}.${libExt()}`)

  const mod = await import(bindingsPath)
  return mod.load(libPath) as T
}

const libExt = (): string => {
  if (process.platform === "darwin") return "dylib"
  if (process.platform === "win32") return "dll"
  return "so"
}
