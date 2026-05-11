import { test, expect } from "bun:test"
import {
  extractExports,
  extractRustExports,
  extractZigExports,
  generateBindings,
} from "../src/native/parser"

const C_SOURCE = `
#include "butter.h"

static int internal_helper(int x) { return x * 2; }

BUTTER_EXPORT(
  int fast_hash(const char *input, int len) {
    int hash = 0;
    for (int i = 0; i < len; i++) hash = hash * 31 + input[i];
    return hash;
  }

  double multiply(double a, double b) {
    return a * b;
  }

  void greet(const char *name) {
    printf("Hello, %s\\n", name);
  }
)
`

const MOXY_SOURCE = `
#include "butter.h"

BUTTER_EXPORT(
  int add(int a, int b) {
    return a + b;
  }

  float average(float x, float y) {
    return (x + y) / 2.0;
  }

  int hash(string input, int len) {
    int h = 0;
    for i in 0..len { h = h * 31 + input[i]; }
    return h;
  }
)
`

test("extractExports parses C functions", () => {
  const fns = extractExports(C_SOURCE)
  expect(fns).toHaveLength(3)

  expect(fns[0].name).toBe("fast_hash")
  expect(fns[0].returnType).toBe("number")
  expect(fns[0].params).toHaveLength(2)
  expect(fns[0].params[0].name).toBe("input")
  expect(fns[0].params[0].ffitype).toBe("FFIType.cstring")
  expect(fns[0].params[1].name).toBe("len")
  expect(fns[0].params[1].ffitype).toBe("FFIType.i32")

  expect(fns[1].name).toBe("multiply")
  expect(fns[1].params).toHaveLength(2)
  expect(fns[1].params[0].ffitype).toBe("FFIType.f64")

  expect(fns[2].name).toBe("greet")
  expect(fns[2].returnType).toBe("void")
})

test("extractExports parses Moxy functions", () => {
  const fns = extractExports(MOXY_SOURCE)
  expect(fns).toHaveLength(3)

  expect(fns[0].name).toBe("add")
  expect(fns[2].name).toBe("hash")
  expect(fns[2].params[0].name).toBe("input")
  expect(fns[2].params[0].ffitype).toBe("FFIType.cstring")
})

test("extractExports ignores functions outside BUTTER_EXPORT", () => {
  const source = `
    int not_exported(int x) { return x; }
    BUTTER_EXPORT(
      int exported(int x) { return x * 2; }
    )
  `
  const fns = extractExports(source)
  expect(fns).toHaveLength(1)
  expect(fns[0].name).toBe("exported")
})

test("generateBindings produces valid TypeScript", () => {
  const fns = extractExports(C_SOURCE)
  const code = generateBindings("crypto", fns)

  expect(code).toContain("export type CryptoNative")
  expect(code).toContain("fast_hash:")
  expect(code).toContain("multiply:")
  expect(code).toContain("greet:")
  expect(code).toContain("FFIType.cstring")
  expect(code).toContain("FFIType.f64")
  expect(code).toContain("export const load")
})

test("empty source returns no exports", () => {
  const fns = extractExports("int main() { return 0; }")
  expect(fns).toHaveLength(0)
})

const RUST_SOURCE = `
fn not_exported(x: i32) -> i32 { x * 2 }

// @butter-export
#[no_mangle]
pub extern "C" fn add(a: i32, b: i32) -> i32 {
  a + b
}

// @butter-export
#[no_mangle]
pub extern "C" fn multiply(a: f64, b: f64) -> f64 {
  a * b
}

// @butter-export
#[no_mangle]
pub extern "C" fn fast_hash(input: *const u8, len: i32) -> i32 {
  let _ = (input, len);
  0
}

// @butter-export
#[no_mangle]
pub extern "C" fn greet(name: *const std::os::raw::c_char) {
  let _ = name;
}
`

test("extractRustExports parses Rust functions", () => {
  const fns = extractRustExports(RUST_SOURCE)
  expect(fns).toHaveLength(4)

  expect(fns[0].name).toBe("add")
  expect(fns[0].returnType).toBe("number")
  expect(fns[0].params).toHaveLength(2)
  expect(fns[0].params[0].name).toBe("a")
  expect(fns[0].params[0].ffitype).toBe("FFIType.i32")

  expect(fns[1].name).toBe("multiply")
  expect(fns[1].params[0].ffitype).toBe("FFIType.f64")
  expect(fns[1].ffiReturn).toBe("FFIType.f64")

  // *const u8 → cstring (byte buffer, null-terminated convention from JS side)
  expect(fns[2].name).toBe("fast_hash")
  expect(fns[2].params[0].ffitype).toBe("FFIType.cstring")
  expect(fns[2].params[1].ffitype).toBe("FFIType.i32")

  // *const std::os::raw::c_char → cstring; std::os::raw:: prefix is stripped
  expect(fns[3].name).toBe("greet")
  expect(fns[3].params[0].ffitype).toBe("FFIType.cstring")
  expect(fns[3].returnType).toBe("void")
})

test("extractRustExports ignores functions without the marker", () => {
  const fns = extractRustExports(`
    #[no_mangle]
    pub extern "C" fn not_marked(x: i32) -> i32 { x }
  `)
  expect(fns).toHaveLength(0)
})

const ZIG_SOURCE = `
const std = @import("std");

fn private_helper(x: i32) i32 { return x * 2; }

// @butter-export
export fn add(a: i32, b: i32) i32 {
  return a + b;
}

// @butter-export
export fn fib(n: i32) i32 {
  return if (n < 2) n else fib(n - 1) + fib(n - 2);
}

// @butter-export
export fn average(x: f64, y: f64) f64 {
  return (x + y) / 2.0;
}

// @butter-export
export fn greet(name: [*:0]const u8) void {
  _ = name;
}
`

test("extractZigExports parses Zig functions", () => {
  const fns = extractZigExports(ZIG_SOURCE)
  expect(fns).toHaveLength(4)

  expect(fns[0].name).toBe("add")
  expect(fns[0].params[0].ffitype).toBe("FFIType.i32")
  expect(fns[0].ffiReturn).toBe("FFIType.i32")

  expect(fns[1].name).toBe("fib")
  expect(fns[1].params).toHaveLength(1)

  expect(fns[2].name).toBe("average")
  expect(fns[2].params[0].ffitype).toBe("FFIType.f64")
  expect(fns[2].ffiReturn).toBe("FFIType.f64")

  // [*:0]const u8 → cstring
  expect(fns[3].name).toBe("greet")
  expect(fns[3].params[0].ffitype).toBe("FFIType.cstring")
  expect(fns[3].returnType).toBe("void")
})

test("extractZigExports ignores functions without the marker", () => {
  const fns = extractZigExports(`
    export fn not_marked(x: i32) i32 { return x; }
  `)
  expect(fns).toHaveLength(0)
})

test("generateBindings is language-agnostic", () => {
  // Same bindings shape regardless of source language — everything ends up
  // crossing the C ABI through bun:ffi.
  const rustFns = extractRustExports(RUST_SOURCE)
  const zigFns = extractZigExports(ZIG_SOURCE)

  const rustCode = generateBindings("rmath", rustFns)
  expect(rustCode).toContain("export type RmathNative")
  expect(rustCode).toContain("add:")
  expect(rustCode).toContain("FFIType.f64")
  expect(rustCode).toContain("FFIType.cstring")

  const zigCode = generateBindings("zmath", zigFns)
  expect(zigCode).toContain("export type ZmathNative")
  expect(zigCode).toContain("fib:")
  expect(zigCode).toContain("greet:")
})
