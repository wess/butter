import { test, expect } from "bun:test"
import { shimSourcePath, shimBinaryPath, needsRecompile } from "../src/shim"

test("shimSourcePath returns darwin.c on macOS", () => {
  const path = shimSourcePath()
  expect(path).toContain("darwin.m")
})

test("shimBinaryPath returns .butter/shim", () => {
  const path = shimBinaryPath("/tmp/testproject")
  expect(path).toBe("/tmp/testproject/.butter/shim")
})

test("needsRecompile returns true when binary missing", async () => {
  const result = await needsRecompile("/tmp/nonexistent/.butter/shim", shimSourcePath())
  expect(result).toBe(true)
})
