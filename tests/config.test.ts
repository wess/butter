import { test, expect } from "bun:test"
import { parseConfig, defaultConfig, interpolateEnv } from "../src/config"

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

test("interpolateEnv replaces {SHOUTY_VARS} with env values", () => {
  const result = interpolateEnv(
    { id: "{MY_ID}", name: "literal", arr: ["{A}", "x"] },
    { MY_ID: "abc123", A: "alpha" },
  )
  expect(result).toEqual({ id: "abc123", name: "literal", arr: ["alpha", "x"] })
})

test("interpolateEnv leaves JSON-style braces alone", () => {
  // lowercase, mixed-case, or whitespace inside braces shouldn't match.
  const result = interpolateEnv(
    { css: "{ color: red }", code: "{abc}", glob: "{a,b}" },
    {},
  )
  expect(result.css).toBe("{ color: red }")
  expect(result.code).toBe("{abc}")
  expect(result.glob).toBe("{a,b}")
})

test("interpolateEnv resolves missing vars to empty string", () => {
  const result = interpolateEnv({ x: "{NOT_SET}" }, {})
  expect(result.x).toBe("")
})

test("parseConfig interpolates env in bundle.macos block", () => {
  const yaml = `
window: { title: "Demo", width: 100, height: 100 }
build: { entry: "a", host: "b" }
bundle:
  identifier: io.example.demo
  macos:
    signingIdentity: "{APPLE_SIGNING_IDENTITY}"
    appleId: "{APPLE_ID}"
    teamId: "{APPLE_TEAM_ID}"
    appleIdPassword: "{APPLE_APP_PASSWORD}"
    hardenedRuntime: true
    notarize: true
`
  const c = parseConfig(yaml, {
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Acme (T1)",
    APPLE_ID: "dev@acme.com",
    APPLE_TEAM_ID: "T1",
    APPLE_APP_PASSWORD: "app-specific-pw",
  })
  expect(c.bundle?.macos?.signingIdentity).toBe("Developer ID Application: Acme (T1)")
  expect(c.bundle?.macos?.appleId).toBe("dev@acme.com")
  expect(c.bundle?.macos?.teamId).toBe("T1")
  expect(c.bundle?.macos?.appleIdPassword).toBe("app-specific-pw")
  expect(c.bundle?.macos?.hardenedRuntime).toBe(true)
  expect(c.bundle?.macos?.notarize).toBe(true)
})

test("parseConfig drops empty bundle.macos creds when env vars unset", () => {
  const yaml = `
window: { title: "Demo", width: 100, height: 100 }
build: { entry: "a", host: "b" }
bundle:
  macos:
    signingIdentity: "{APPLE_SIGNING_IDENTITY}"
    appleId: "{APPLE_ID}"
    notarize: true
`
  const c = parseConfig(yaml, {})
  expect(c.bundle?.macos?.signingIdentity).toBeUndefined()
  expect(c.bundle?.macos?.appleId).toBeUndefined()
  // notarize flag still survives — sign step uses it to decide whether to try.
  expect(c.bundle?.macos?.notarize).toBe(true)
})
