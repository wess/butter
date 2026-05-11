# Native Extensions

Butter lets you write performance-critical code in **C**, **[Moxy](https://github.com/moxylang/moxy)**, **Rust**, or **Zig** and call it directly from TypeScript. No manual FFI setup — Butter auto-compiles your native code and generates typed bindings.

## When to Use Native Extensions

Most Butter apps don't need native code. TypeScript in Bun is fast enough for UI logic, API calls, and data processing. Use native extensions when you need:

- CPU-intensive computation (image processing, cryptography, physics)
- Direct access to OS APIs not exposed by Bun
- Wrapping existing C / Rust / Zig libraries
- Maximum performance for hot code paths

Drop a source file (or a Cargo project directory) into `src/native/` and Butter handles the rest.

## Writing a Moxy Extension

[Moxy](https://github.com/moxylang/moxy) is a lightweight superset of C with modern syntax — `string` type, `for i in 0..n` loops, `print()`, and more. It transpiles to clean C11.

Create `src/native/math.mxy`:

```moxy
// @butter-export
int add(int a, int b) {
  return a + b;
}

// @butter-export
int fibonacci(int n) {
  if (n <= 1) { return n; }
  int a = 0;
  int b = 1;
  for i in 2..n+1 {
    int tmp = b;
    b = a + b;
    a = tmp;
  }
  return b;
}
```

Mark each exported function with `// @butter-export` on the line above. Functions without this annotation are internal and won't be exposed to TypeScript.

## Writing a C Extension

Create `src/native/crypto.c`:

```c
#include "butter.h"
#include <string.h>

/* Internal helper — not exported */
static int hash_step(int hash, char c) {
    return hash * 31 + c;
}

BUTTER_EXPORT(
  int fast_hash(const char *input, int len) {
    int hash = 0;
    for (int i = 0; i < len; i++) hash = hash_step(hash, input[i]);
    return hash;
  }

  double lerp(double a, double b, double t) {
    return a + (b - a) * t;
  }
)
```

Wrap exported functions in `BUTTER_EXPORT(...)`. The `butter.h` header is automatically available — just `#include "butter.h"`.

## Writing a Rust Extension (Single File)

Create `src/native/math.rs`:

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

Mark each exported function with `// @butter-export` above the declaration. You still need `#[no_mangle]` and `extern "C"` so the symbol is actually exported with C ABI — the comment is just the trigger that tells Butter's parser to scan the signature.

Butter compiles this with `rustc --crate-type cdylib --edition 2021 -C opt-level=3`. There's no `Cargo.toml`, so you're limited to `std` and `core::ffi`. If you need crates from `crates.io`, use the Cargo project form below.

## Writing a Rust Extension (Cargo Project)

Use this when you need third-party crates, multiple source files, or workspace integration.

Create `src/native/hashlib/Cargo.toml`:

```toml
[package]
name = "hashlib"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[profile.release]
opt-level = 3
```

Create `src/native/hashlib/src/lib.rs`:

```rust
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

// @butter-export
#[no_mangle]
pub extern "C" fn checksum(input: *const u8, len: i32) -> u32 {
    let mut s: u32 = 0;
    unsafe {
        for i in 0..len {
            s = s.wrapping_add(*input.offset(i as isize) as u32);
        }
    }
    s
}
```

The module name is the **directory name** (`hashlib`). `[lib].crate-type = ["cdylib"]` is required — without it cargo produces an rlib that can't be loaded via FFI. Butter scans every `.rs` file in the project for `// @butter-export` markers, so exports can live in any file the crate compiles.

Then use it from TypeScript:

```ts
const hashlib = await native("hashlib")
hashlib.fast_hash("hello", 5)
```

## Writing a Zig Extension

Create `src/native/fib.zig`:

```zig
// @butter-export
export fn add(a: i32, b: i32) i32 {
    return a + b;
}

// @butter-export
export fn fib(n: i32) i32 {
    if (n < 2) return n;
    return fib(n - 1) + fib(n - 2);
}

// @butter-export
export fn average(x: f64, y: f64) f64 {
    return (x + y) / 2.0;
}
```

The `export` keyword is what makes the symbol C-callable; `// @butter-export` is the marker the parser scans for. Butter compiles with `zig build-lib -dynamic -OReleaseFast`.

For C strings use Zig's null-terminated pointer type:

```zig
const std = @import("std");

// @butter-export
export fn strlen_zig(s: [*:0]const u8) i32 {
    return @intCast(std.mem.len(s));
}
```

## Using Native Modules from TypeScript

In your host code (`src/host/index.ts`):

```ts
import { on } from "butter"
import { native } from "butter/native"

const math = await native("math")
const crypto = await native("crypto")
const fib = await native("fib")
const hashlib = await native("hashlib")

on("calculate", (data: { a: number; b: number }) => {
  return {
    sum: math.add(data.a, data.b),
    fib20: fib.fib(20),
    hash: crypto.fast_hash("hello", 5),
    checksum: hashlib.checksum("hello", 5),
  }
})
```

The module name matches the filename without extension — `math.mxy` becomes `native("math")`, `crypto.c` becomes `native("crypto")`, `fib.zig` becomes `native("fib")`. For Cargo projects, it matches the directory name (`hashlib/` → `native("hashlib")`).

## How It Works

When you run `butter dev` or `butter compile`:

1. Butter scans `src/native/` for `.c`, `.mxy`, `.rs`, `.zig` files, and subdirectories with `Cargo.toml`
2. For Moxy files, transpiles to C via the `moxy` CLI
3. Compiles each source through the right toolchain — clang/cc/cl for C, rustc or cargo for Rust, zig for Zig
4. Parses sources to extract exported function signatures
5. Generates typed TypeScript FFI bindings in `.butter/native/<name>.ts`
6. The `native()` function loads the shared library and returns the bound functions

Each built artifact is paired with a `.fp` fingerprint file in `.butter/native/`. Subsequent builds skip recompilation when the source bytes, compiler flags, platform, and architecture all match.

## Doctor Checks

Run `butter doctor` to see which toolchains are available:

```
  Bun ........................... v1.3.13
  Compiler ...................... clang 17.0.0
  Webview ....................... WKWebView (macOS)
  Rust (optional) ............... rustc 1.95.0, cargo 1.95.0
  Zig (optional) ................ zig 0.14.0
```

Rust and Zig are **optional** — `butter doctor` always passes if they're missing. They're only required when your project actually has `.rs` or `.zig` sources to build.

Install pages:
- Rust — https://www.rust-lang.org/tools/install
- Zig — https://ziglang.org/download
- Moxy — https://github.com/moxylang/moxy

## Supported Types

The full type-mapping matrix lives in the [Native Extensions Reference](../reference/native.md#type-mapping). Quick summary:

- All integer widths (`i8`–`i64`, `u8`–`u64`) map to `number`
- `f32` and `f64` map to `number`
- `bool` maps to `boolean`
- Null-terminated byte pointers (`const char *` in C, `string` in Moxy, `*const c_char` / `*const u8` in Rust, `[*:0]const u8` in Zig) map to `string` and are auto-null-terminated when passed from JS
- Other pointers map to `number` (raw address) via `FFIType.ptr`

## Tips

- Keep native modules small and focused — one module per concern
- Pick the language that fits the job: Moxy for greenfield numeric code, C for wrapping existing libraries, Rust when you want safety + crate ecosystem, Zig for low-level work without a runtime
- Functions not marked with the language's export trigger stay internal
- The generated bindings live at `.butter/native/<name>.ts` if you want to inspect what was parsed
- `BUTTER_ALLOW_NATIVE_SKIP=1` downgrades compile failures to warnings — handy when iterating on one module without breaking the whole dev loop
