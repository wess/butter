import { test, expect, describe, beforeEach } from "bun:test"
import type { Config, MenuItem, Menu, Plugin, WindowOptions, IpcMessage } from "../src/types"
import { createTypedHandlers } from "../src/types/handler"
import { createTypedInvoke } from "../src/types/invoke"
import { createRuntime } from "../src/runtime"

// Existing type usability tests

test("Config type is usable", () => {
  const config: Config = {
    window: { title: "Test", width: 800, height: 600 },
    build: { entry: "src/app/index.html", host: "src/host/index.ts" },
  }
  expect(config.window.title).toBe("Test")
})

test("Menu type is usable", () => {
  const menu: Menu = [
    {
      label: "File",
      items: [
        { label: "Quit", action: "app:quit", shortcut: "CmdOrCtrl+Q" },
        { separator: true },
      ],
    },
  ]
  expect(menu[0].label).toBe("File")
  expect(menu[0].items).toHaveLength(2)
})

test("Plugin type is usable", () => {
  const plugin: Plugin = {
    name: "test",
    host: ({ on }) => { on("test", () => "ok") },
    webview: () => "window.butter.test = {}",
  }
  expect(plugin.name).toBe("test")
})

test("IpcMessage type is usable", () => {
  const msg: IpcMessage = {
    id: "1",
    type: "invoke",
    action: "greet",
    data: { name: "world" },
  }
  expect(msg.action).toBe("greet")
})

// Typed handlers and invoke tests

type TestApi = {
  "math:add": { input: { a: number; b: number }; output: number }
  "greet:hello": { input: string; output: string }
  "data:fetch": { input: { id: number }; output: { name: string; value: number } }
}

describe("createTypedHandlers", () => {
  beforeEach(() => {
    const rt = createRuntime()
    globalThis.__butterRuntime = rt
  })

  test("returns an object with an on method", () => {
    const handlers = createTypedHandlers<TestApi>()
    expect(typeof handlers.on).toBe("function")
  })

  test("on method registers a handler that can be dispatched", () => {
    const rt = createRuntime()
    globalThis.__butterRuntime = rt
    const handlers = createTypedHandlers<TestApi>()
    handlers.on("math:add", (data) => data.a + data.b)
    const result = rt.dispatch("math:add", { a: 3, b: 7 })
    expect(result).toBe(10)
  })

  test("can register multiple handlers", () => {
    const rt = createRuntime()
    globalThis.__butterRuntime = rt
    const handlers = createTypedHandlers<TestApi>()
    handlers.on("math:add", (data) => data.a + data.b)
    handlers.on("greet:hello", (name) => `Hello, ${name}!`)
    expect(rt.dispatch("math:add", { a: 1, b: 2 })).toBe(3)
    expect(rt.dispatch("greet:hello", "World")).toBe("Hello, World!")
  })

  test("handler can return complex objects", () => {
    const rt = createRuntime()
    globalThis.__butterRuntime = rt
    const handlers = createTypedHandlers<TestApi>()
    handlers.on("data:fetch", (data) => ({ name: `item-${data.id}`, value: data.id * 10 }))
    const result = rt.dispatch("data:fetch", { id: 5 }) as { name: string; value: number }
    expect(result.name).toBe("item-5")
    expect(result.value).toBe(50)
  })

  test("handler can return a promise", async () => {
    const rt = createRuntime()
    globalThis.__butterRuntime = rt
    const handlers = createTypedHandlers<TestApi>()
    handlers.on("math:add", async (data) => data.a + data.b)
    const result = rt.dispatch("math:add", { a: 10, b: 20 })
    expect(result).toBeInstanceOf(Promise)
    expect(await result).toBe(30)
  })

  test("overwriting a handler replaces the previous one", () => {
    const rt = createRuntime()
    globalThis.__butterRuntime = rt
    const handlers = createTypedHandlers<TestApi>()
    handlers.on("math:add", (_data) => 0)
    handlers.on("math:add", (data) => data.a * data.b)
    expect(rt.dispatch("math:add", { a: 3, b: 4 })).toBe(12)
  })
})

describe("createTypedInvoke", () => {
  test("returns an object with an invoke method", () => {
    const invoker = createTypedInvoke<TestApi>()
    expect(typeof invoker.invoke).toBe("function")
  })

  test("invoke calls globalThis.butter.invoke with correct args", async () => {
    let capturedAction: string | undefined
    let capturedData: unknown
    ;(globalThis as any).butter = {
      invoke: (action: string, data: unknown, _opts: unknown) => {
        capturedAction = action
        capturedData = data
        return Promise.resolve(42)
      },
    }
    const invoker = createTypedInvoke<TestApi>()
    const result = await invoker.invoke("math:add", { a: 1, b: 2 })
    expect(capturedAction).toBe("math:add")
    expect(capturedData).toEqual({ a: 1, b: 2 })
    expect(result).toBe(42)
  })

  test("invoke passes opts through", async () => {
    let capturedOpts: unknown
    ;(globalThis as any).butter = {
      invoke: (_action: string, _data: unknown, opts: unknown) => {
        capturedOpts = opts
        return Promise.resolve("ok")
      },
    }
    const invoker = createTypedInvoke<TestApi>()
    await invoker.invoke("greet:hello", "test", { timeout: 5000 })
    expect(capturedOpts).toEqual({ timeout: 5000 })
  })

  test("invoke returns a promise", () => {
    ;(globalThis as any).butter = {
      invoke: () => Promise.resolve({ name: "test", value: 99 }),
    }
    const invoker = createTypedInvoke<TestApi>()
    const result = invoker.invoke("data:fetch", { id: 1 })
    expect(result).toBeInstanceOf(Promise)
  })

  test("invoke propagates rejection from butter.invoke", async () => {
    ;(globalThis as any).butter = {
      invoke: () => Promise.reject(new Error("timeout")),
    }
    const invoker = createTypedInvoke<TestApi>()
    let caught = false
    try {
      await invoker.invoke("math:add", { a: 1, b: 2 })
    } catch (e: any) {
      caught = true
      expect(e.message).toBe("timeout")
    }
    expect(caught).toBe(true)
  })
})

test("Config supports dev.mcp options", () => {
  const config: Config = {
    window: { title: "x", width: 100, height: 100 },
    build: { entry: "x", host: "x" },
    dev: { mcp: { enabled: true, port: 4711, consoleBuffer: 1000 } },
  }
  expect(config.dev?.mcp?.port).toBe(4711)
})

describe("WindowOptions type shape", () => {
  test("supports all optional fields", () => {
    const opts: WindowOptions = {
      title: "Full",
      width: 1920,
      height: 1080,
      icon: "icon.png",
      x: 0,
      y: 0,
      minWidth: 400,
      minHeight: 300,
      resizable: true,
      frameless: false,
      transparent: false,
      alwaysOnTop: false,
      fullscreen: false,
    }
    expect(opts.title).toBe("Full")
    expect(opts.minWidth).toBe(400)
    expect(opts.frameless).toBe(false)
  })

  test("only requires title, width, height", () => {
    const minimal: WindowOptions = { title: "Min", width: 640, height: 480 }
    expect(minimal.icon).toBeUndefined()
    expect(minimal.resizable).toBeUndefined()
  })
})

describe("IpcMessage type shape", () => {
  test("supports all message types", () => {
    const types: IpcMessage["type"][] = ["invoke", "response", "event", "control"]
    for (const t of types) {
      const msg: IpcMessage = { id: "1", type: t, action: "test" }
      expect(msg.type).toBe(t)
    }
  })

  test("error field is optional", () => {
    const msg: IpcMessage = { id: "1", type: "response", action: "test", error: "fail" }
    expect(msg.error).toBe("fail")
    const msg2: IpcMessage = { id: "2", type: "response", action: "test" }
    expect(msg2.error).toBeUndefined()
  })
})
