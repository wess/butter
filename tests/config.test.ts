import { test, expect } from "bun:test"
import { parseConfig, defaultConfig } from "../src/config"

test("defaultConfig has sensible defaults", () => {
  const config = defaultConfig()
  expect(config.window.title).toBe("Butter App")
  expect(config.window.width).toBe(800)
  expect(config.window.height).toBe(600)
  expect(config.build.entry).toBe("src/app/index.html")
  expect(config.build.host).toBe("src/host/index.ts")
})

test("parseConfig parses valid yaml", () => {
  const yaml = `
window:
  title: My App
  width: 1024
  height: 768

build:
  entry: src/app/index.html
  host: src/host/index.ts
`
  const config = parseConfig(yaml)
  expect(config.window.title).toBe("My App")
  expect(config.window.width).toBe(1024)
})

test("parseConfig fills missing fields with defaults", () => {
  const yaml = `
window:
  title: Partial
`
  const config = parseConfig(yaml)
  expect(config.window.title).toBe("Partial")
  expect(config.window.width).toBe(800)
  expect(config.build.entry).toBe("src/app/index.html")
})

test("parseConfig handles plugins list", () => {
  const yaml = `
window:
  title: Test
plugins:
  - butter-plugin-dialog
  - butter-plugin-tray
`
  const config = parseConfig(yaml)
  expect(config.plugins).toEqual(["butter-plugin-dialog", "butter-plugin-tray"])
})

test("parseConfig parses security.csp and security.allowlist", () => {
  const yaml = `
window: { title: "x", width: 100, height: 100 }
build: { entry: "a", host: "b" }
security:
  csp: "default-src 'self'"
  allowlist:
    - "dialog:*"
    - "fs:read"
`
  const c = parseConfig(yaml)
  expect(c.security?.csp).toBe("default-src 'self'")
  expect(c.security?.allowlist).toEqual(["dialog:*", "fs:read"])
})

test("parseConfig parses splash", () => {
  const yaml = `
window: { title: "x", width: 100, height: 100 }
build: { entry: "a", host: "b" }
splash: src/app/splash.html
`
  const c = parseConfig(yaml)
  expect(c.splash).toBe("src/app/splash.html")
})

test("parseConfig parses dev.mcp.* with defaults applied", () => {
  const yaml = `
window: { title: "x", width: 100, height: 100 }
build: { entry: "a", host: "b" }
dev:
  mcp:
    enabled: false
`
  const c = parseConfig(yaml)
  expect(c.dev?.mcp?.enabled).toBe(false)
})

test("parseConfig defaults dev to undefined when absent", () => {
  const yaml = `
window: { title: "x", width: 100, height: 100 }
build: { entry: "a", host: "b" }
`
  const c = parseConfig(yaml)
  expect(c.dev).toBeUndefined()
})
