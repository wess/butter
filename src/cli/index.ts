#!/usr/bin/env bun
const command = process.argv[2]

const commands: Record<string, () => Promise<void>> = {
  doctor: async () => {
    const { runDoctor, printDoctorResults } = await import("./doctor")
    const results = await runDoctor()
    printDoctorResults(results)
  },
  init: async () => {
    const { runInit } = await import("./init")
    await runInit(process.argv.slice(3))
  },
  dev: async () => {
    const { runDev } = await import("./dev")
    await runDev(process.cwd())
  },
  compile: async () => {
    const { runCompile } = await import("./compile")
    await runCompile(process.cwd(), process.argv.slice(3))
  },
  bundle: async () => {
    const { runBundle } = await import("./bundle")
    await runBundle(process.cwd())
  },
}

const run = async () => {
  if (!command || command === "help") {
    console.log("Usage: butter <command>")
    console.log()
    console.log("Commands:")
    console.log("  init <name> [--template vanilla|react|svelte|vue]")
    console.log("  dev            Start development mode")
    console.log("  compile        Build a single-file binary")
    console.log("  compile --target darwin|linux|windows")
    console.log("  bundle         Wrap compiled binary in a native app package")
    console.log("  doctor         Check platform prerequisites")
    return
  }

  const handler = commands[command]
  if (!handler) {
    console.error(`Unknown command: ${command}`)
    process.exit(1)
  }

  await handler()
}

run()
