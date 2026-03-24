# Native Extensions

Butter lets you write performance-critical code in C or [Moxy](https://github.com/moxylang/moxy) and call it directly from TypeScript. No manual FFI setup — Butter auto-compiles your native code and generates typed bindings.

## When to Use Native Extensions

Most Butter apps don't need native code. TypeScript in Bun is fast enough for UI logic, API calls, and data processing. Use native extensions when you need:

- CPU-intensive computation (image processing, cryptography, physics)
- Direct access to OS APIs not exposed by Bun
- Wrapping existing C libraries
- Maximum performance for hot code paths

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

// @butter-export
int factorial(int n) {
  if (n <= 1) { return 1; }
  return n * factorial(n - 1);
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

## Using Native Modules from TypeScript

In your host code (`src/host/index.ts`):

```ts
import { on } from "butter"
import { native } from "butter/native"

const math = await native("math")
const crypto = await native("crypto")

on("calculate", (data: { a: number; b: number }) => {
  return {
    sum: math.add(data.a, data.b),
    fib20: math.fibonacci(20),
    hash: crypto.fast_hash("hello", 5),
  }
})
```

The module name matches the filename without extension — `math.mxy` becomes `native("math")`, `crypto.c` becomes `native("crypto")`.

## How It Works

When you run `butter dev` or `butter compile`:

1. Butter scans `src/native/` for `.c` and `.mxy` files
2. For Moxy files, transpiles to C via the `moxy` CLI
3. Compiles each file to a shared library (`.dylib` on macOS, `.so` on Linux)
4. Parses the source to extract exported function signatures
5. Generates typed TypeScript FFI bindings in `.butter/native/`
6. The `native()` function loads the shared library and returns the bound functions

Shared libraries are cached in `.butter/native/` and only recompiled when the source changes.

## Supported Types

| C Type | Moxy Type | TypeScript Type | FFI Type |
|--------|-----------|-----------------|----------|
| `int` | `int` | `number` | `i32` |
| `float` | `float` | `number` | `f32` |
| `double` | `double` | `number` | `f64` |
| `char` | `char` | `number` | `i8` |
| `bool` | `bool` | `boolean` | `bool` |
| `long` | `long` | `number` | `i64` |
| `const char *` | `string` | `string` | `cstring` |
| `void` | `void` | `void` | `void` |
| `T *` | `T *` | `number` | `ptr` |

## Tips

- Keep native modules small and focused — one module per concern
- Use Moxy for new code, C for wrapping existing libraries
- Functions not marked with `BUTTER_EXPORT` or `// @butter-export` stay internal
- The generated bindings are in `.butter/native/<name>.ts` if you want to inspect them
- Native modules are compiled with `-O2` optimization by default
