# Native Extensions Reference

## Overview

Butter compiles source files in `src/native/` into shared libraries and auto-generates typed TypeScript FFI bindings via `bun:ffi`. Four source languages are supported. All cross the C ABI in the end, so the generated bindings file is identical regardless of source language.

| Source | Build path |
|---|---|
| `*.c` | clang / cc / cl.exe (gcc fallback on Windows) |
| `*.mxy` ([Moxy](https://github.com/moxylang/moxy)) | moxy transpile → C → C compiler |
| `*.rs` | `rustc --crate-type cdylib --edition 2021 -C opt-level=3` |
| `*.zig` | `zig build-lib -dynamic -OReleaseFast` |
| `<dir>/Cargo.toml` | `cargo build --release` (multi-file Rust project) |

## File Locations

| Path | Description |
|------|-------------|
| `src/native/*.c` | C source files |
| `src/native/*.mxy` | Moxy source files |
| `src/native/*.rs` | Single-file Rust source |
| `src/native/*.zig` | Zig source files |
| `src/native/<name>/Cargo.toml` | Multi-file Rust project (must set `crate-type = ["cdylib"]`) |
| `src/native/butter.h` | Header with `BUTTER_EXPORT` macro (auto-copied; only needed by C/Moxy) |
| `.butter/native/*.dylib` / `*.so` / `*.dll` | Compiled shared libraries (cached) |
| `.butter/native/*.ts` | Generated TypeScript bindings |
| `.butter/native/*.fp` | Fingerprint cache file |

## Marking Functions for Export

### C: `BUTTER_EXPORT(...)`

Wrap one or more functions in the macro:

```c
#include "butter.h"

BUTTER_EXPORT(
  int add(int a, int b) { return a + b; }
  double lerp(double a, double b, double t) { return a + (b - a) * t; }
)
```

Functions outside `BUTTER_EXPORT()` are not exported. The macro compiles to a no-op — Butter's parser extracts signatures at build time.

### Moxy: `// @butter-export`

Annotate each function individually:

```moxy
// @butter-export
int add(int a, int b) {
  return a + b;
}

// @butter-export
double lerp(double a, double b, double t) {
  return a + (b - a) * t;
}
```

Moxy files cannot use `BUTTER_EXPORT()` because the Moxy transpiler treats macro bodies as opaque text and won't transpile Moxy syntax inside them.

### Rust: `// @butter-export`

Annotate each function. You still need `#[no_mangle]` and `extern "C"` so the symbol actually gets exported — the comment is just the marker the parser scans for.

```rust
// @butter-export
#[no_mangle]
pub extern "C" fn add(a: i32, b: i32) -> i32 {
    a + b
}

// @butter-export
#[no_mangle]
pub extern "C" fn fast_hash(input: *const u8, len: i32) -> i32 {
    let mut h: i32 = 0;
    unsafe {
        for i in 0..len {
            h = h.wrapping_mul(31).wrapping_add(*input.offset(i as isize) as i32);
        }
    }
    h
}
```

Multi-line attributes between the marker and the `fn` declaration are fine — the parser accumulates lines until it finds the signature.

### Zig: `// @butter-export`

Annotate each function. The `export` keyword on the function itself is what makes the symbol C-callable; the comment is the marker.

```zig
// @butter-export
export fn add(a: i32, b: i32) i32 {
    return a + b;
}

// @butter-export
export fn greet(name: [*:0]const u8) void {
    _ = name;
}
```

## Loading Native Modules

```ts
import { native } from "butter/native"

const mod = await native("modulename")
```

The module name is the filename without extension (or the directory name for Cargo projects). `math.mxy`, `math.c`, `math.rs`, and `math.zig` all become `native("math")`. A Cargo project at `src/native/hash/Cargo.toml` becomes `native("hash")`.

### `native<T>(name: string): Promise<T>`

Loads a compiled native module and returns an object with all exported functions bound via FFI.

**Parameters:**
- `name` — module name (filename without extension, or Cargo project directory name)

**Returns:** Promise resolving to an object with typed function properties.

**Throws:** If the module hasn't been compiled or the bindings file is missing.

## Type Mapping

The same `bun:ffi` types underlie all languages. The columns below show how each language's native types map to the generated binding.

| FFI Type | TS Type | C / Moxy | Rust | Zig |
|---|---|---|---|---|
| `i8` | `number` | `char`, `int8_t` | `i8`, `c_char`, `c_schar` | `i8`, `c_char`, `c_schar` |
| `u8` | `number` | `unsigned char`, `uint8_t` | `u8`, `c_uchar` | `u8`, `c_uchar` |
| `i16` | `number` | `short`, `int16_t` | `i16`, `c_short` | `i16`, `c_short` |
| `u16` | `number` | `unsigned short`, `uint16_t` | `u16`, `c_ushort` | `u16`, `c_ushort` |
| `i32` | `number` | `int`, `int32_t` | `i32`, `c_int` | `i32`, `c_int` |
| `u32` | `number` | `unsigned int`, `uint32_t` | `u32`, `c_uint` | `u32`, `c_uint` |
| `i64` | `number` | `long`, `int64_t` | `i64`, `c_long`, `isize` | `i64`, `c_long`, `isize` |
| `u64` | `number` | `unsigned long`, `uint64_t`, `size_t` | `u64`, `c_ulong`, `usize` | `u64`, `c_ulong`, `usize` |
| `f32` | `number` | `float` | `f32`, `c_float` | `f32` |
| `f64` | `number` | `double` | `f64`, `c_double` | `f64` |
| `bool` | `boolean` | `bool` | `bool` | `bool` |
| `void` | `void` | `void` | `()`, `c_void` | `void` |
| `cstring` | `string` | `const char *`, `string` (Moxy) | `*const c_char`, `*const u8` | `[*:0]const u8` |
| `ptr` | `number` | any other `T *` | any other `*const T` / `*mut T` | any other `*T` / `[*]T` / `?*T` |

Path-prefixed Rust types are normalized: `std::os::raw::c_char`, `core::ffi::c_int`, and `libc::c_uint` are all recognized.

String parameters (any type that maps to `cstring`) are automatically null-terminated — the generated binding wraps them with `Buffer.from(str + "\0")` before passing into the FFI call.

## Compilation

### C files

- **macOS**: `clang -shared -fPIC -fvisibility=default -O2`
- **Linux**: `cc -shared -fPIC -fvisibility=default -O2`
- **Windows**: `cl.exe /LD /O2` (MSVC) or `gcc -shared -fPIC -O2` (MinGW fallback)

### Moxy files

1. Transpiled to C via `moxy <file.mxy>` (stdout)
2. Generated C saved to `.butter/native/<name>.c`
3. Compiled with the same flags as C files

Requires `moxy` to be installed. See [Moxy installation](https://github.com/moxylang/moxy#installation).

### Rust single-file (`*.rs`)

```
rustc --crate-type cdylib --edition 2021 -C opt-level=3 -o <out>.<ext> <src>.rs
```

No `Cargo.toml`, no `crates.io` dependencies. Suitable for self-contained modules that only use `std` and `core::ffi`.

### Rust Cargo projects (`<dir>/Cargo.toml`)

```
cargo build --release
```

Run inside the project directory. The `Cargo.toml` **must** declare:

```toml
[lib]
crate-type = ["cdylib"]
```

After cargo finishes, Butter copies the produced `target/release/lib<name>.<ext>` (or `<name>.dll` on Windows) into `.butter/native/<modulename>.<ext>`. The module name comes from `[lib].name` if set, otherwise `[package].name` (with hyphens converted to underscores, matching Cargo's own rule).

Butter scans every `.rs` file under the project (excluding `target/`) for `// @butter-export` markers — exports can live in any file the crate compiles.

### Zig files (`*.zig`)

```
zig build-lib -dynamic -OReleaseFast -femit-bin=<out>.<ext> <src>.zig
```

Zig leaves a small `<out>.<ext>.o` object file beside the binary; this is a harmless build artifact inside `.butter/native/`.

### Caching

Each compiled library has a sibling `.fp` file containing a SHA-256 fingerprint of the source bytes, compiler-flag signature, platform, and architecture. A build is skipped when the recomputed fingerprint matches the cached value.

For Cargo projects the fingerprint covers every `.rs` file in the project plus `Cargo.toml`. Cargo's own `target/` cache is ignored.

Delete `.butter/native/` to force a full rebuild. Set `BUTTER_ALLOW_NATIVE_SKIP=1` to downgrade compile failures to warnings (the failing module is omitted from the build).

## Generated Bindings

For a module `math` with functions `add(int, int) -> int` and `multiply(int, int) -> int`, Butter generates:

```ts
// .butter/native/math.ts (auto-generated)
import { dlopen, FFIType, suffix } from "bun:ffi"

export type MathNative = {
  add: (a: number, b: number) => number
  multiply: (a: number, b: number) => number
}

export const load = (libPath: string): MathNative => {
  const lib = dlopen(libPath, {
    add: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    multiply: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  })
  return {
    add: (a, b) => lib.symbols.add(a, b) as number,
    multiply: (a, b) => lib.symbols.multiply(a, b) as number,
  }
}
```

The bindings file is identical in shape whether the source was C, Moxy, Rust, or Zig — only the `args`/`returns` FFI types differ based on the parsed signatures.

## butter.h

```c
#ifdef _WIN32
  #define BUTTER_API __declspec(dllexport)
#else
  #define BUTTER_API __attribute__((visibility("default")))
#endif

#define BUTTER_EXPORT(...) __VA_ARGS__
```

The macro is a pass-through. Symbol visibility is controlled by compiler flags, not per-function attributes. The header is only used by C and Moxy; Rust uses `#[no_mangle] pub extern "C"` and Zig uses `export fn` to expose symbols, so `butter.h` is not needed there.

## Doctor

`butter doctor` reports Rust (`rustc` + `cargo`) and Zig (`zig`) as **optional** checks. Missing tools are shown in the report but don't fail the doctor unless a project actually has `.rs` or `.zig` sources that need them.

```
  Bun ........................... v1.3.13
  Compiler ...................... clang 17.0.0
  Webview ....................... WKWebView (macOS)
  Rust (optional) ............... rustc 1.95.0, cargo 1.95.0
  Zig (optional) ................ zig 0.14.0

  All checks passed.
```
