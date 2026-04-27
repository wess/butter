import { test, expect } from "bun:test"
import { join } from "path"
import { shimSourcePath, shimBinaryPath, needsRecompile } from "../src/shim"

const expectedShimSource =
  process.platform === "darwin"
    ? "darwin.m"
    : process.platform === "linux"
      ? "linux.c"
      : "windows.c"

const expectedShimExt = process.platform === "win32" ? ".exe" : ""

test(`shimSourcePath returns ${expectedShimSource} on ${process.platform}`, () => {
  const path = shimSourcePath()
  expect(path).toContain(expectedShimSource)
})

test("shimBinaryPath returns the .butter/shim path", () => {
  const path = shimBinaryPath("/tmp/testproject")
  expect(path).toBe(join("/tmp/testproject", ".butter", `shim${expectedShimExt}`))
})

test("needsRecompile returns true when binary missing", async () => {
  const result = await needsRecompile("/tmp/nonexistent/.butter/shim", shimSourcePath())
  expect(result).toBe(true)
})
