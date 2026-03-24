import { test, expect } from "bun:test"
import { checkBun, checkCompiler, checkWebview, runDoctor } from "../src/cli/doctor"

test("checkBun returns version", async () => {
  const result = await checkBun()
  expect(result.ok).toBe(true)
  expect(result.detail).toMatch(/\d+\.\d+/)
})

test("checkCompiler finds clang on macOS", async () => {
  if (process.platform !== "darwin") return
  const result = await checkCompiler()
  expect(result.ok).toBe(true)
  expect(result.detail).toContain("clang")
})

test("checkWebview reports OK on macOS", async () => {
  if (process.platform !== "darwin") return
  const result = await checkWebview()
  expect(result.ok).toBe(true)
  expect(result.detail).toContain("WKWebView")
})

test("runDoctor returns all checks", async () => {
  const results = await runDoctor()
  expect(results.length).toBeGreaterThanOrEqual(3)
  expect(results.every((r) => typeof r.ok === "boolean")).toBe(true)
})
