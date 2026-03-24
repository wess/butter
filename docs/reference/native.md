# Native Extensions Reference

## Overview

Butter compiles C and [Moxy](https://github.com/moxylang/moxy) source files in `src/native/` into shared libraries and auto-generates typed TypeScript FFI bindings via `bun:ffi`.

## File Locations

| Path | Description |
|------|-------------|
| `src/native/*.c` | C source files |
| `src/native/*.mxy` | Moxy source files |
| `src/native/butter.h` | Header with `BUTTER_EXPORT` macro (auto-copied) |
| `.butter/native/*.dylib` | Compiled shared libraries (cached) |
| `.butter/native/*.ts` | Generated TypeScript bindings |

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

## Loading Native Modules

```ts
import { native } from "butter/native"

const mod = await native("modulename")
```

The module name is the filename without extension. `math.mxy` and `math.c` both become `native("math")`.

### `native<T>(name: string): Promise<T>`

Loads a compiled native module and returns an object with all exported functions bound via FFI.

**Parameters:**
- `name` — module name (matches filename without extension)

**Returns:** Promise resolving to an object with typed function properties.

**Throws:** If the module hasn't been compiled or the bindings file is missing.

## Type Mapping

| C / Moxy Type | FFI Type | TypeScript Type |
|---------------|----------|-----------------|
| `int` | `FFIType.i32` | `number` |
| `unsigned int` | `FFIType.u32` | `number` |
| `short` | `FFIType.i16` | `number` |
| `long` | `FFIType.i64` | `number` |
| `float` | `FFIType.f32` | `number` |
| `double` | `FFIType.f64` | `number` |
| `char` | `FFIType.i8` | `number` |
| `bool` | `FFIType.bool` | `boolean` |
| `void` | `FFIType.void` | `void` |
| `size_t` | `FFIType.u64` | `number` |
| `const char *` / `string` (Moxy) | `FFIType.cstring` | `string` |
| `T *` (any pointer) | `FFIType.ptr` | `number` |
| `int8_t` through `uint64_t` | corresponding FFIType | `number` |

String parameters (`const char *` in C, `string` in Moxy) are automatically converted — the generated binding wraps them with `Buffer.from(str + "\0")`.

## Compilation

### C files

Compiled with the system C compiler:

- **macOS**: `clang -shared -fPIC -fvisibility=default -O2`
- **Linux**: `cc -shared -fPIC -fvisibility=default -O2`

### Moxy files

1. Transpiled to C via `moxy <file.mxy>` (stdout)
2. Generated C saved to `.butter/native/<name>.c`
3. Compiled with the same flags as C files

Requires `moxy` to be installed. See [Moxy installation](https://github.com/moxylang/moxy#installation).

### Caching

Shared libraries are cached in `.butter/native/`. Recompilation occurs only when the source file's modification time is newer than the library. Delete `.butter/native/` to force a full rebuild.

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

## butter.h

```c
#ifdef _WIN32
  #define BUTTER_API __declspec(dllexport)
#else
  #define BUTTER_API __attribute__((visibility("default")))
#endif

#define BUTTER_EXPORT(...) __VA_ARGS__
```

The macro is a pass-through. Symbol visibility is controlled by the compiler flags, not per-function attributes.
