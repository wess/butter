import { test, expect, describe } from "bun:test"

/**
 * Tests for the CLI command registry in src/cli/index.ts.
 *
 * Since the CLI entry script runs immediately and calls process.exit,
 * we cannot import it directly. Instead we read the file and verify
 * the command structure statically, then test individual importable modules.
 */

const expectedCommands = ["doctor", "init", "dev", "compile", "bundle", "sign"]

describe("cli command registry", () => {
  test("src/cli/index.ts exists and is readable", async () => {
    const file = Bun.file("src/cli/index.ts")
    expect(await file.exists()).toBe(true)
  })

  test("all 6 commands are defined in the commands record", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    for (const cmd of expectedCommands) {
      expect(source).toContain(`${cmd}:`)
    }
  })

  test("each command has an async handler", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    for (const cmd of expectedCommands) {
      const pattern = new RegExp(`${cmd}:\\s*async`)
      expect(pattern.test(source)).toBe(true)
    }
  })

  test("doctor command imports from ./doctor", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    expect(source).toContain('./doctor"')
  })

  test("init command imports from ./init", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    expect(source).toContain('./init"')
  })

  test("dev command imports from ./dev", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    expect(source).toContain('./dev"')
  })

  test("compile command imports from ./compile", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    expect(source).toContain('./compile"')
  })

  test("bundle command imports from ./bundle", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    expect(source).toContain('./bundle"')
  })

  test("sign command imports from ./sign", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    expect(source).toContain('./sign"')
  })

  test("help text lists all commands", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    expect(source).toContain("init")
    expect(source).toContain("dev")
    expect(source).toContain("compile")
    expect(source).toContain("bundle")
    expect(source).toContain("sign")
    expect(source).toContain("doctor")
  })

  test("no extra unexpected commands in the record", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    // Extract the commands record block
    const match = source.match(/const commands.*?=\s*\{([\s\S]*?)\n\}/)
    expect(match).not.toBeNull()
    const block = match![1]
    // Count command keys (lines with "word: async")
    const keys = block.match(/(\w+):\s*async/g) || []
    expect(keys).toHaveLength(6)
  })
})

describe("cli module imports", () => {
  test("doctor module exports runDoctor", async () => {
    const mod = await import("../src/cli/doctor")
    expect(typeof mod.runDoctor).toBe("function")
  })

  test("doctor module exports printDoctorResults", async () => {
    const mod = await import("../src/cli/doctor")
    expect(typeof mod.printDoctorResults).toBe("function")
  })

  test("bundle module exports runBundle", async () => {
    const mod = await import("../src/cli/bundle")
    expect(typeof mod.runBundle).toBe("function")
  })

  test("bundle module exports bundleMacApp", async () => {
    const mod = await import("../src/cli/bundle")
    expect(typeof mod.bundleMacApp).toBe("function")
  })

  test("bundle module exports bundleLinuxAppDir", async () => {
    const mod = await import("../src/cli/bundle")
    expect(typeof mod.bundleLinuxAppDir).toBe("function")
  })

  test("compile module exports runCompile", async () => {
    const mod = await import("../src/cli/compile")
    expect(typeof mod.runCompile).toBe("function")
  })

  test("dev module exports runDev", async () => {
    const mod = await import("../src/cli/dev")
    expect(typeof mod.runDev).toBe("function")
  })

  test("init module exports runInit", async () => {
    const mod = await import("../src/cli/init")
    expect(typeof mod.runInit).toBe("function")
  })

  test("sign module exports runSign", async () => {
    const mod = await import("../src/cli/sign")
    expect(typeof mod.runSign).toBe("function")
  })
})

describe("cli entry point structure", () => {
  test("has shebang line for bun", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    expect(source.startsWith("#!/usr/bin/env bun")).toBe(true)
  })

  test("reads command from process.argv[2]", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    expect(source).toContain("process.argv[2]")
  })

  test("handles unknown commands with process.exit(1)", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    expect(source).toContain("Unknown command")
    expect(source).toContain("process.exit(1)")
  })

  test("shows help when no command or help command", async () => {
    const source = await Bun.file("src/cli/index.ts").text()
    expect(source).toContain('command === "help"')
    expect(source).toContain("Usage: butter <command>")
  })
})
