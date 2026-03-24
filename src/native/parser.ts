/*
 * Parses C/Moxy source files to extract function signatures from BUTTER_EXPORT blocks.
 * Generates TypeScript FFI binding code for use with bun:ffi.
 */

export type FfiParam = {
  name: string
  ctype: string
  ffitype: string
}

export type FfiFunction = {
  name: string
  returnType: string
  ffiReturn: string
  params: FfiParam[]
}

const C_TO_FFI: Record<string, string> = {
  "int": "FFIType.i32",
  "unsigned int": "FFIType.u32",
  "long": "FFIType.i64",
  "unsigned long": "FFIType.u64",
  "short": "FFIType.i16",
  "unsigned short": "FFIType.u16",
  "char": "FFIType.i8",
  "unsigned char": "FFIType.u8",
  "float": "FFIType.f32",
  "double": "FFIType.f64",
  "bool": "FFIType.bool",
  "void": "FFIType.void",
  "size_t": "FFIType.u64",
  "int8_t": "FFIType.i8",
  "int16_t": "FFIType.i16",
  "int32_t": "FFIType.i32",
  "int64_t": "FFIType.i64",
  "uint8_t": "FFIType.u8",
  "uint16_t": "FFIType.u16",
  "uint32_t": "FFIType.u32",
  "uint64_t": "FFIType.u64",
}

const C_TO_TS: Record<string, string> = {
  "int": "number",
  "unsigned int": "number",
  "long": "number",
  "unsigned long": "number",
  "short": "number",
  "unsigned short": "number",
  "char": "number",
  "unsigned char": "number",
  "float": "number",
  "double": "number",
  "bool": "boolean",
  "void": "void",
  "size_t": "number",
  "int8_t": "number",
  "int16_t": "number",
  "int32_t": "number",
  "int64_t": "number",
  "uint8_t": "number",
  "uint16_t": "number",
  "uint32_t": "number",
  "uint64_t": "number",
}

const resolveType = (raw: string): { ctype: string; ffitype: string; tstype: string } => {
  const trimmed = raw.trim()

  // Pointer types (char*, const char*, string in Moxy) → cstring or ptr
  if (trimmed === "string" || trimmed === "const char *" || trimmed === "const char*" || trimmed === "char *" || trimmed === "char*") {
    return { ctype: trimmed, ffitype: "FFIType.cstring", tstype: "string" }
  }
  if (trimmed.endsWith("*")) {
    return { ctype: trimmed, ffitype: "FFIType.ptr", tstype: "number" }
  }

  // Strip const
  const base = trimmed.replace(/^const\s+/, "")

  const ffi = C_TO_FFI[base]
  const ts = C_TO_TS[base]

  if (ffi) return { ctype: trimmed, ffitype: ffi, tstype: ts }

  // Unknown type — treat as ptr
  return { ctype: trimmed, ffitype: "FFIType.ptr", tstype: "number" }
}

const parseFunctionSignature = (sig: string): FfiFunction | null => {
  // Match: returnType functionName(params...)
  const match = sig.match(/^\s*([\w\s*]+?)\s+(\w+)\s*\(([^)]*)\)/)
  if (!match) return null

  const [, rawReturn, name, rawParams] = match
  const ret = resolveType(rawReturn)

  const params: FfiParam[] = []
  if (rawParams.trim()) {
    for (const param of rawParams.split(",")) {
      const p = param.trim()
      // Split "int len" or "const char *input" into type + name
      const lastSpace = p.lastIndexOf(" ")
      const lastStar = p.lastIndexOf("*")
      const splitAt = Math.max(lastSpace, lastStar)

      if (splitAt <= 0) continue

      let ptype: string
      let pname: string
      if (lastStar > lastSpace) {
        ptype = p.substring(0, lastStar + 1).trim()
        pname = p.substring(lastStar + 1).trim()
      } else {
        ptype = p.substring(0, lastSpace).trim()
        pname = p.substring(lastSpace + 1).trim()
      }

      const resolved = resolveType(ptype)
      params.push({ name: pname, ctype: resolved.ctype, ffitype: resolved.ffitype })
    }
  }

  return { name, returnType: ret.tstype, ffiReturn: ret.ffitype, params }
}

export const extractExports = (source: string): FfiFunction[] => {
  const functions: FfiFunction[] = []

  // Method 1: Find BUTTER_EXPORT(...) blocks (C files)
  let idx = 0
  while (idx < source.length) {
    const start = source.indexOf("BUTTER_EXPORT(", idx)
    if (start === -1) break

    let depth = 0
    let blockStart = start + "BUTTER_EXPORT".length
    let blockEnd = blockStart

    for (let i = blockStart; i < source.length; i++) {
      if (source[i] === "(") depth++
      if (source[i] === ")") {
        depth--
        if (depth === 0) {
          blockEnd = i
          break
        }
      }
    }

    const block = source.substring(blockStart + 1, blockEnd)

    const sigRegex = /^[ \t]*((?:const\s+)?[\w\s*]+?)\s+(\w+)\s*\([^)]*\)\s*\{/gm
    let sigMatch
    while ((sigMatch = sigRegex.exec(block)) !== null) {
      const sigEnd = block.indexOf("{", sigMatch.index)
      const sigStr = block.substring(sigMatch.index, sigEnd).trim()
      const fn = parseFunctionSignature(sigStr)
      if (fn) functions.push(fn)
    }

    idx = blockEnd + 1
  }

  // Method 2: Find // @butter-export annotations (Moxy files)
  const lines = source.split("\n")
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "// @butter-export") {
      // Next non-empty line should be a function signature
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j].trim()
        if (!line) continue
        const sigMatch = line.match(/^((?:const\s+)?[\w\s*]+?)\s+(\w+)\s*\([^)]*\)\s*\{/)
        if (sigMatch) {
          const sigEnd = line.indexOf("{")
          const sigStr = line.substring(0, sigEnd).trim()
          const fn = parseFunctionSignature(sigStr)
          if (fn) functions.push(fn)
        }
        break
      }
    }
  }

  return functions
}

export const generateBindings = (moduleName: string, functions: FfiFunction[]): string => {
  const ffiDefs = functions.map((fn) => {
    const args = fn.params.map((p) => p.ffitype).join(", ")
    return `    ${fn.name}: { args: [${args}], returns: ${fn.ffiReturn} },`
  }).join("\n")

  const typedFns = functions.map((fn) => {
    const params = fn.params.map((p) => {
      const tstype = resolveType(p.ctype).tstype
      return `${p.name}: ${tstype}`
    }).join(", ")
    return `  ${fn.name}: (${params}) => ${fn.returnType}`
  }).join("\n")

  return `// Auto-generated FFI bindings for "${moduleName}"
// Do not edit — regenerated by butter dev/compile

import { dlopen, FFIType, suffix } from "bun:ffi"
import { join } from "path"

export type ${capitalize(moduleName)}Native = {
${typedFns}
}

export const load = (libPath: string): ${capitalize(moduleName)}Native => {
  const lib = dlopen(libPath, {
${ffiDefs}
  })

  return {
${functions.map((fn) => {
    const args = fn.params.map((p) => p.name).join(", ")
    const castArgs = fn.params.map((p) => {
      if (p.ffitype === "FFIType.cstring") return `Buffer.from(${p.name} + "\\0")`
      return p.name
    }).join(", ")
    return `    ${fn.name}: (${args}) => lib.symbols.${fn.name}(${castArgs}) as ${fn.returnType},`
  }).join("\n")}
  }
}
`
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
