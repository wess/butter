/*
 * Parses native-extension source files (C, Moxy, Rust, Zig) to extract function
 * signatures from BUTTER_EXPORT blocks or // @butter-export annotations.
 * Generates TypeScript FFI binding code for use with bun:ffi.
 *
 * Public entry points:
 *   extractExports(source)       — C and Moxy (BUTTER_EXPORT + // @butter-export)
 *   extractRustExports(source)   — Rust (// @butter-export above pub extern "C" fn)
 *   extractZigExports(source)    — Zig  (// @butter-export above export fn)
 *   generateBindings(name, fns)  — same bindings file for all four languages
 *                                  (everything crosses the C ABI in the end)
 */

export type FfiParam = {
  name: string;
  ctype: string;
  ffitype: string;
};

export type FfiFunction = {
  name: string;
  returnType: string;
  ffiReturn: string;
  params: FfiParam[];
};

const C_TO_FFI: Record<string, string> = {
  int: "FFIType.i32",
  "unsigned int": "FFIType.u32",
  long: "FFIType.i64",
  "unsigned long": "FFIType.u64",
  short: "FFIType.i16",
  "unsigned short": "FFIType.u16",
  char: "FFIType.i8",
  "unsigned char": "FFIType.u8",
  float: "FFIType.f32",
  double: "FFIType.f64",
  bool: "FFIType.bool",
  void: "FFIType.void",
  size_t: "FFIType.u64",
  int8_t: "FFIType.i8",
  int16_t: "FFIType.i16",
  int32_t: "FFIType.i32",
  int64_t: "FFIType.i64",
  uint8_t: "FFIType.u8",
  uint16_t: "FFIType.u16",
  uint32_t: "FFIType.u32",
  uint64_t: "FFIType.u64",
};

const C_TO_TS: Record<string, string> = {
  int: "number",
  "unsigned int": "number",
  long: "number",
  "unsigned long": "number",
  short: "number",
  "unsigned short": "number",
  char: "number",
  "unsigned char": "number",
  float: "number",
  double: "number",
  bool: "boolean",
  void: "void",
  size_t: "number",
  int8_t: "number",
  int16_t: "number",
  int32_t: "number",
  int64_t: "number",
  uint8_t: "number",
  uint16_t: "number",
  uint32_t: "number",
  uint64_t: "number",
};

const resolveType = (raw: string): { ctype: string; ffitype: string; tstype: string } => {
  const trimmed = raw.trim();

  // Pointer types (char*, const char*, string in Moxy) → cstring or ptr
  if (
    trimmed === "string" ||
    trimmed === "const char *" ||
    trimmed === "const char*" ||
    trimmed === "char *" ||
    trimmed === "char*"
  ) {
    return { ctype: trimmed, ffitype: "FFIType.cstring", tstype: "string" };
  }
  if (trimmed.endsWith("*")) {
    return { ctype: trimmed, ffitype: "FFIType.ptr", tstype: "number" };
  }

  // Strip const
  const base = trimmed.replace(/^const\s+/, "");

  const ffi = C_TO_FFI[base];
  const ts = C_TO_TS[base];

  if (ffi && ts) {
    return { ctype: trimmed, ffitype: ffi, tstype: ts };
  }

  // Unknown type — treat as ptr
  return { ctype: trimmed, ffitype: "FFIType.ptr", tstype: "number" };
};

const parseFunctionSignature = (sig: string): FfiFunction | null => {
  // Match: returnType functionName(params...)
  const match = sig.match(/^\s*([\w\s*]+?)\s+(\w+)\s*\(([^)]*)\)/);
  if (!match) {
    return null;
  }

  const [, rawReturn, name, rawParams] = match;
  if (rawReturn === undefined || name === undefined || rawParams === undefined) {
    return null;
  }
  const ret = resolveType(rawReturn);

  const params: FfiParam[] = [];
  if (rawParams.trim()) {
    for (const param of rawParams.split(",")) {
      const p = param.trim();
      // Split "int len" or "const char *input" into type + name
      const lastSpace = p.lastIndexOf(" ");
      const lastStar = p.lastIndexOf("*");
      const splitAt = Math.max(lastSpace, lastStar);

      if (splitAt <= 0) {
        continue;
      }

      let ptype: string;
      let pname: string;
      if (lastStar > lastSpace) {
        ptype = p.substring(0, lastStar + 1).trim();
        pname = p.substring(lastStar + 1).trim();
      } else {
        ptype = p.substring(0, lastSpace).trim();
        pname = p.substring(lastSpace + 1).trim();
      }

      const resolved = resolveType(ptype);
      params.push({ name: pname, ctype: resolved.ctype, ffitype: resolved.ffitype });
    }
  }

  return { name, returnType: ret.tstype, ffiReturn: ret.ffitype, params };
};

export const extractExports = (source: string): FfiFunction[] => {
  const functions: FfiFunction[] = [];

  // Method 1: Find BUTTER_EXPORT(...) blocks (C files)
  let idx = 0;
  while (idx < source.length) {
    const start = source.indexOf("BUTTER_EXPORT(", idx);
    if (start === -1) {
      break;
    }

    let depth = 0;
    const blockStart = start + "BUTTER_EXPORT".length;
    let blockEnd = blockStart;

    for (let i = blockStart; i < source.length; i++) {
      if (source[i] === "(") {
        depth++;
      }
      if (source[i] === ")") {
        depth--;
        if (depth === 0) {
          blockEnd = i;
          break;
        }
      }
    }

    const block = source.substring(blockStart + 1, blockEnd);

    const sigRegex = /^[ \t]*((?:const\s+)?[\w\s*]+?)\s+(\w+)\s*\([^)]*\)\s*\{/gm;
    let sigMatch: RegExpExecArray | null = sigRegex.exec(block);
    while (sigMatch !== null) {
      const sigEnd = block.indexOf("{", sigMatch.index);
      const sigStr = block.substring(sigMatch.index, sigEnd).trim();
      const fn = parseFunctionSignature(sigStr);
      if (fn) {
        functions.push(fn);
      }
      sigMatch = sigRegex.exec(block);
    }

    idx = blockEnd + 1;
  }

  // Method 2: Find // @butter-export annotations (Moxy files)
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() === "// @butter-export") {
      // Next non-empty line should be a function signature
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j]?.trim();
        if (!line) {
          continue;
        }
        const sigMatch = line.match(/^((?:const\s+)?[\w\s*]+?)\s+(\w+)\s*\([^)]*\)\s*\{/);
        if (sigMatch) {
          const sigEnd = line.indexOf("{");
          const sigStr = line.substring(0, sigEnd).trim();
          const fn = parseFunctionSignature(sigStr);
          if (fn) {
            functions.push(fn);
          }
        }
        break;
      }
    }
  }

  return functions;
};

// ---------- Rust ----------

const RUST_TO_FFI: Record<string, string> = {
  i8: "FFIType.i8",
  i16: "FFIType.i16",
  i32: "FFIType.i32",
  i64: "FFIType.i64",
  u8: "FFIType.u8",
  u16: "FFIType.u16",
  u32: "FFIType.u32",
  u64: "FFIType.u64",
  f32: "FFIType.f32",
  f64: "FFIType.f64",
  bool: "FFIType.bool",
  usize: "FFIType.u64",
  isize: "FFIType.i64",
  c_char: "FFIType.i8",
  c_schar: "FFIType.i8",
  c_uchar: "FFIType.u8",
  c_short: "FFIType.i16",
  c_ushort: "FFIType.u16",
  c_int: "FFIType.i32",
  c_uint: "FFIType.u32",
  c_long: "FFIType.i64",
  c_ulong: "FFIType.u64",
  c_float: "FFIType.f32",
  c_double: "FFIType.f64",
  c_void: "FFIType.void",
};

const RUST_TO_TS: Record<string, string> = {
  i8: "number",
  i16: "number",
  i32: "number",
  i64: "number",
  u8: "number",
  u16: "number",
  u32: "number",
  u64: "number",
  f32: "number",
  f64: "number",
  bool: "boolean",
  usize: "number",
  isize: "number",
  c_char: "number",
  c_schar: "number",
  c_uchar: "number",
  c_short: "number",
  c_ushort: "number",
  c_int: "number",
  c_uint: "number",
  c_long: "number",
  c_ulong: "number",
  c_float: "number",
  c_double: "number",
};

const stripRustPath = (raw: string): string =>
  raw.replace(/(?:std::os::raw::|core::ffi::|std::ffi::|libc::)/g, "").trim();

const resolveRustType = (raw: string): { ctype: string; ffitype: string; tstype: string } => {
  const trimmed = stripRustPath(raw);
  if (trimmed === "" || trimmed === "()") {
    return { ctype: "()", ffitype: "FFIType.void", tstype: "void" };
  }
  // Null-terminated byte pointers → cstring (matches the bindings-side
  // `Buffer.from(s + "\0")` trick that already works for C/Moxy).
  if (/^\*\s*(?:const|mut)\s+(?:c_char|u8|i8)\b/.test(trimmed)) {
    return { ctype: trimmed, ffitype: "FFIType.cstring", tstype: "string" };
  }
  if (trimmed.startsWith("*")) {
    return { ctype: trimmed, ffitype: "FFIType.ptr", tstype: "number" };
  }
  const ffi = RUST_TO_FFI[trimmed];
  if (ffi) {
    return { ctype: trimmed, ffitype: ffi, tstype: RUST_TO_TS[trimmed] ?? "number" };
  }
  // Unknown type — fall through as a raw pointer. dlopen will surface a real
  // error at link time if the symbol/ABI mismatch matters.
  return { ctype: trimmed, ffitype: "FFIType.ptr", tstype: "number" };
};

const parseRustSignature = (sig: string): FfiFunction | null => {
  // Capture: fn name(params) [-> ret]
  // Leading attributes (#[...]), `pub`, `extern "C"` are tolerated by anchoring
  // on the `fn` keyword rather than the line start.
  const m = sig.match(/\bfn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^{;]+?))?\s*$/);
  if (!m) {
    return null;
  }
  const [, name, rawParams, rawRet] = m;
  if (name === undefined || rawParams === undefined) {
    return null;
  }
  const ret = resolveRustType(rawRet ?? "()");
  const params: FfiParam[] = [];
  if (rawParams.trim()) {
    for (const param of rawParams.split(",")) {
      const p = param.trim();
      if (!p) {
        continue;
      }
      const colon = p.indexOf(":");
      if (colon === -1) {
        continue;
      }
      const pname = p.substring(0, colon).trim();
      const ptype = p.substring(colon + 1).trim();
      const resolved = resolveRustType(ptype);
      params.push({ name: pname, ctype: resolved.ctype, ffitype: resolved.ffitype });
    }
  }
  return { name, returnType: ret.tstype, ffiReturn: ret.ffitype, params };
};

export const extractRustExports = (source: string): FfiFunction[] => {
  const functions: FfiFunction[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() !== "// @butter-export") {
      continue;
    }
    // Collect lines after the marker until we reach `{` (function body) or `;`
    // (extern declaration). Attributes and qualifiers span multiple lines in
    // typical Rust style, so we accumulate until the signature is complete.
    let buf = "";
    for (let j = i + 1; j < lines.length; j++) {
      const stripped = lines[j]?.split("//")[0] ?? "";
      buf += ` ${stripped}`;
      const terminator = buf.search(/[{;]/);
      if (terminator !== -1) {
        const sig = buf.substring(0, terminator).trim();
        if (/\bfn\s+\w+/.test(sig)) {
          const fn = parseRustSignature(sig);
          if (fn) {
            functions.push(fn);
          }
        }
        break;
      }
    }
  }
  return functions;
};

// ---------- Zig ----------

const ZIG_TO_FFI: Record<string, string> = {
  i8: "FFIType.i8",
  i16: "FFIType.i16",
  i32: "FFIType.i32",
  i64: "FFIType.i64",
  u8: "FFIType.u8",
  u16: "FFIType.u16",
  u32: "FFIType.u32",
  u64: "FFIType.u64",
  f32: "FFIType.f32",
  f64: "FFIType.f64",
  bool: "FFIType.bool",
  void: "FFIType.void",
  usize: "FFIType.u64",
  isize: "FFIType.i64",
  c_char: "FFIType.i8",
  c_schar: "FFIType.i8",
  c_uchar: "FFIType.u8",
  c_short: "FFIType.i16",
  c_ushort: "FFIType.u16",
  c_int: "FFIType.i32",
  c_uint: "FFIType.u32",
  c_long: "FFIType.i64",
  c_ulong: "FFIType.u64",
};

const ZIG_TO_TS: Record<string, string> = {
  i8: "number",
  i16: "number",
  i32: "number",
  i64: "number",
  u8: "number",
  u16: "number",
  u32: "number",
  u64: "number",
  f32: "number",
  f64: "number",
  bool: "boolean",
  void: "void",
  usize: "number",
  isize: "number",
  c_char: "number",
  c_schar: "number",
  c_uchar: "number",
  c_short: "number",
  c_ushort: "number",
  c_int: "number",
  c_uint: "number",
  c_long: "number",
  c_ulong: "number",
};

const resolveZigType = (raw: string): { ctype: string; ffitype: string; tstype: string } => {
  const trimmed = raw.trim();
  // Null-terminated byte pointers: [*:0]const u8, [*:0]u8 — Zig's idiomatic
  // C-string form. Falls back to plain pointer for everything else.
  if (/^\[\*:0\]\s*(?:const\s+)?u8\b/.test(trimmed)) {
    return { ctype: trimmed, ffitype: "FFIType.cstring", tstype: "string" };
  }
  if (
    trimmed.startsWith("*") ||
    trimmed.startsWith("[*") ||
    trimmed.startsWith("?*") ||
    trimmed.startsWith("?[")
  ) {
    return { ctype: trimmed, ffitype: "FFIType.ptr", tstype: "number" };
  }
  const ffi = ZIG_TO_FFI[trimmed];
  if (ffi) {
    return { ctype: trimmed, ffitype: ffi, tstype: ZIG_TO_TS[trimmed] ?? "number" };
  }
  return { ctype: trimmed, ffitype: "FFIType.ptr", tstype: "number" };
};

const parseZigSignature = (sig: string): FfiFunction | null => {
  // Capture: fn name(params) ret_type   (Zig has no -> before the return type)
  const m = sig.match(/\bfn\s+(\w+)\s*\(([^)]*)\)\s+(.+?)\s*$/);
  if (!m) {
    return null;
  }
  const [, name, rawParams, rawRet] = m;
  if (name === undefined || rawParams === undefined || rawRet === undefined) {
    return null;
  }
  const ret = resolveZigType(rawRet);
  const params: FfiParam[] = [];
  if (rawParams.trim()) {
    for (const param of rawParams.split(",")) {
      const p = param.trim();
      if (!p) {
        continue;
      }
      const colon = p.indexOf(":");
      if (colon === -1) {
        continue;
      }
      const pname = p.substring(0, colon).trim();
      const ptype = p.substring(colon + 1).trim();
      const resolved = resolveZigType(ptype);
      params.push({ name: pname, ctype: resolved.ctype, ffitype: resolved.ffitype });
    }
  }
  return { name, returnType: ret.tstype, ffiReturn: ret.ffitype, params };
};

export const extractZigExports = (source: string): FfiFunction[] => {
  const functions: FfiFunction[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() !== "// @butter-export") {
      continue;
    }
    let buf = "";
    for (let j = i + 1; j < lines.length; j++) {
      const stripped = lines[j]?.split("//")[0] ?? "";
      buf += ` ${stripped}`;
      const terminator = buf.search(/[{;]/);
      if (terminator !== -1) {
        const sig = buf.substring(0, terminator).trim();
        if (/\bfn\s+\w+/.test(sig)) {
          const fn = parseZigSignature(sig);
          if (fn) {
            functions.push(fn);
          }
        }
        break;
      }
    }
  }
  return functions;
};

// ---------- Bindings codegen (language-agnostic) ----------

export const generateBindings = (moduleName: string, functions: FfiFunction[]): string => {
  const ffiDefs = functions
    .map((fn) => {
      const args = fn.params.map((p) => p.ffitype).join(", ");
      return `    ${fn.name}: { args: [${args}], returns: ${fn.ffiReturn} },`;
    })
    .join("\n");

  const typedFns = functions
    .map((fn) => {
      const params = fn.params
        .map((p) => {
          const tstype = resolveType(p.ctype).tstype;
          return `${p.name}: ${tstype}`;
        })
        .join(", ");
      return `  ${fn.name}: (${params}) => ${fn.returnType}`;
    })
    .join("\n");

  return `// Auto-generated FFI bindings for "${moduleName}"
// Do not edit — regenerated by butter dev/compile

import { dlopen, FFIType, suffix, CString } from "bun:ffi"
import { join } from "path"

export type ${capitalize(moduleName)}Native = {
${typedFns}
  /**
   * Subscribe to events emitted by the native module via butter_emit().
   * Returns an unsubscribe function. Data is parsed as JSON if non-empty.
   */
  on: (action: string, fn: (data: unknown) => void) => () => void
  /**
   * Stop the internal event-drain interval. Call from beforeExit if you want
   * a clean shutdown; otherwise the interval is lightweight (~16ms tick).
   */
  dispose: () => void
}

export const load = (libPath: string): ${capitalize(moduleName)}Native => {
  const lib = dlopen(libPath, {
${ffiDefs}
    butter_drain_next: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  })

  const listeners = new Map<string, Set<(data: unknown) => void>>()
  const actionBuf = Buffer.alloc(64)
  const dataBuf = Buffer.alloc(4096)
  const drainFn = lib.symbols.butter_drain_next as
    | ((a: Buffer, b: Buffer) => number)
    | undefined

  const drain = (): void => {
    if (!drainFn) return
    while (drainFn(actionBuf, dataBuf) === 1) {
      const action = readCString(actionBuf)
      const dataStr = readCString(dataBuf)
      const set = listeners.get(action)
      if (!set || set.size === 0) continue
      let data: unknown = null
      if (dataStr) {
        try { data = JSON.parse(dataStr) } catch { data = dataStr }
      }
      for (const fn of set) {
        try { fn(data) } catch (e) { console.warn(\`[butter:native:\${action}]\`, e) }
      }
    }
  }
  const interval = setInterval(drain, 16)

  return {
${functions
  .map((fn) => {
    const args = fn.params.map((p) => p.name).join(", ");
    const castArgs = fn.params
      .map((p) => {
        if (p.ffitype === "FFIType.cstring") {
          return `Buffer.from(${p.name} + "\\0")`;
        }
        return p.name;
      })
      .join(", ");
    return `    ${fn.name}: (${args}) => lib.symbols.${fn.name}(${castArgs}) as ${fn.returnType},`;
  })
  .join("\n")}
    on: (action, fn) => {
      let set = listeners.get(action)
      if (!set) { set = new Set(); listeners.set(action, set) }
      set.add(fn)
      return () => { set?.delete(fn) }
    },
    dispose: () => { clearInterval(interval); listeners.clear() },
  }
}

const readCString = (buf: Buffer): string => {
  let end = 0
  while (end < buf.length && buf[end] !== 0) end++
  return buf.toString("utf8", 0, end)
}

void CString
`;
};

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
