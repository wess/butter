import { test, expect } from "bun:test"
import { extractExports, generateBindings } from "../src/native/parser"

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
