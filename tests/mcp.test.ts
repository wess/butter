import { test, expect, describe } from "bun:test"
import { createConsoleBuffer } from "../src/mcp/console"
import { wrapEval, wrapClick, wrapFill } from "../src/mcp/wrap"
import { evalTool } from "../src/mcp/tools/eval"
import { consoleTool } from "../src/mcp/tools/console"
import { screenshotTool } from "../src/mcp/tools/screenshot"
import { clickTool } from "../src/mcp/tools/click"
import { fillTool } from "../src/mcp/tools/fill"
import { tmpdir } from "os"

describe("console ring buffer", () => {
  test("starts empty", () => {
    const buf = createConsoleBuffer(10)
    const out = buf.read()
    expect(out.messages).toEqual([])
    expect(out.next_cursor).toBe(0)
  })

  test("push then read returns messages with monotonic cursor", () => {
    const buf = createConsoleBuffer(10)
    buf.push({ level: "log", text: "a" })
    buf.push({ level: "warn", text: "b" })
    const out = buf.read()
    expect(out.messages).toHaveLength(2)
    expect(out.messages[0]).toMatchObject({ level: "log", text: "a" })
    expect(out.next_cursor).toBe(2)
  })

  test("read with since_cursor returns only newer messages", () => {
    const buf = createConsoleBuffer(10)
    buf.push({ level: "log", text: "a" })
    buf.push({ level: "log", text: "b" })
    buf.push({ level: "log", text: "c" })
    const out = buf.read(2)
    expect(out.messages).toHaveLength(1)
    expect(out.messages[0]!.text).toBe("c")
    expect(out.next_cursor).toBe(3)
  })

  test("overflow drops oldest, includes dropped count if cursor is too old", () => {
    const buf = createConsoleBuffer(3)
    buf.push({ level: "log", text: "a" })
    buf.push({ level: "log", text: "b" })
    buf.push({ level: "log", text: "c" })
    buf.push({ level: "log", text: "d" })
    const out = buf.read(0)
    expect(out.dropped).toBeGreaterThanOrEqual(1)
    expect(out.messages.map((m) => m.text)).toEqual(["b", "c", "d"])
  })

  test("messages have a numeric timestamp", () => {
    const buf = createConsoleBuffer(10)
    buf.push({ level: "log", text: "x" })
    const out = buf.read()
    expect(typeof out.messages[0]!.timestamp).toBe("number")
    expect(out.messages[0]!.timestamp).toBeGreaterThan(0)
  })
})

describe("eval JS wrapping", () => {
  test("wrapEval wraps user code with try/catch and JSON.stringify", () => {
    const code = wrapEval("1 + 1", false)
    expect(code).toContain("1 + 1")
    expect(code).toContain("JSON.stringify")
    expect(code).toContain("try")
    expect(code).toContain("catch")
  })

  test("wrapEval async variant uses await", () => {
    const code = wrapEval("await fetch('/x')", true)
    expect(code).toContain("async")
    expect(code).toContain("await")
  })

  test("wrapClick escapes selector with JSON.stringify", () => {
    const code = wrapClick(`button[data-x="' or 1=1 --"]`)
    expect(code).toContain(JSON.stringify(`button[data-x="' or 1=1 --"]`))
    expect(code).toContain(".click()")
  })

  test("wrapFill escapes selector and value", () => {
    const code = wrapFill("#email", `o'malley"@x.com`)
    expect(code).toContain(JSON.stringify("#email"))
    expect(code).toContain(JSON.stringify(`o'malley"@x.com`))
    expect(code).toContain('dispatchEvent(new Event("input"')
    expect(code).toContain('dispatchEvent(new Event("change"')
  })

  test("wrapped click code is valid JS (parses without error)", () => {
    expect(() => new Function(wrapClick("#nonexistent"))).not.toThrow()
  })

  test("wrapEval auto-returns expression user code", () => {
    const code = wrapEval("1 + 1", false)
    const result = JSON.parse(eval(code))
    expect(result).toEqual({ result: 2 })
  })

  test("wrapEval respects explicit return statements", () => {
    const code = wrapEval("const x = 5; return x * 2", false)
    const result = JSON.parse(eval(code))
    expect(result).toEqual({ result: 10 })
  })

  test("wrapClick returns JSON string with ok:true on success", () => {
    // Mock DOM with single matching element
    const mockEl = { click: () => {} }
    ;(globalThis as any).document = { querySelector: () => mockEl }
    try {
      const code = wrapClick("#submit")
      const raw = eval(code)
      expect(typeof raw).toBe("string")
      const parsed = JSON.parse(raw)
      expect(parsed).toEqual({ ok: true })
    } finally {
      delete (globalThis as any).document
    }
  })

  test("wrapClick returns JSON string with error on missing element", () => {
    ;(globalThis as any).document = { querySelector: () => null }
    try {
      const code = wrapClick("#missing")
      const raw = eval(code)
      expect(typeof raw).toBe("string")
      const parsed = JSON.parse(raw)
      expect(parsed.error).toContain("No element matched")
    } finally {
      delete (globalThis as any).document
    }
  })

  test("wrapFill returns JSON string with ok:true on success", () => {
    const events: string[] = []
    const mockEl = {
      value: "",
      dispatchEvent: (e: Event) => { events.push(e.type); return true },
    }
    ;(globalThis as any).document = { querySelector: () => mockEl }
    ;(globalThis as any).Event = class { constructor(public type: string, public init?: any) {} }
    try {
      const code = wrapFill("#email", "test@example.com")
      const raw = eval(code)
      const parsed = JSON.parse(raw)
      expect(parsed).toEqual({ ok: true })
      expect(mockEl.value).toBe("test@example.com")
      expect(events).toEqual(["input", "change"])
    } finally {
      delete (globalThis as any).document
      delete (globalThis as any).Event
    }
  })
})

describe("eval_javascript tool", () => {
  const fakeControl = (action: string, data: unknown) => {
    if (action !== "mcp:eval") throw new Error("unexpected action: " + action)
    const { code } = data as { code: string }
    if (code.includes("throw")) {
      return Promise.resolve(JSON.stringify({ error: "Error: bang" }))
    }
    return Promise.resolve(JSON.stringify({ result: 42 }))
  }

  test("returns parsed result", async () => {
    const out = await evalTool.handler({ code: "return 42" }, fakeControl)
    expect(out.result).toBe(42)
    expect(out.error).toBeUndefined()
  })

  test("returns error on JS exception", async () => {
    const out = await evalTool.handler({ code: "throw new Error('bang')" }, fakeControl)
    expect(out.error).toBe("Error: bang")
  })

  test("await_promise wraps in async IIFE", async () => {
    const seen: string[] = []
    const captureControl = (_a: string, d: unknown) => {
      seen.push((d as { code: string }).code)
      return Promise.resolve(JSON.stringify({ result: null }))
    }
    await evalTool.handler({ code: "1", await_promise: true }, captureControl)
    expect(seen[0]!).toContain("async")
  })

  test("non-JSON response from shim returns error envelope", async () => {
    const garbageControl = () => Promise.resolve("this is not json")
    const out = await evalTool.handler({ code: "1" }, garbageControl)
    expect(out.error).toContain("Could not parse shim response")
  })
})

describe("list_console_messages tool", () => {
  test("returns buffered messages", async () => {
    const buf = createConsoleBuffer(10)
    buf.push({ level: "log", text: "a" })
    buf.push({ level: "warn", text: "b" })
    const out = await consoleTool.handler({}, buf)
    expect(out.messages).toHaveLength(2)
    expect(out.next_cursor).toBe(2)
  })

  test("respects since_cursor", async () => {
    const buf = createConsoleBuffer(10)
    buf.push({ level: "log", text: "a" })
    buf.push({ level: "log", text: "b" })
    const out = await consoleTool.handler({ since_cursor: 1 }, buf)
    expect(out.messages).toHaveLength(1)
    expect(out.messages[0]!.text).toBe("b")
  })

  test("includes dropped count when cursor is too old", async () => {
    const buf = createConsoleBuffer(2)
    buf.push({ level: "log", text: "a" })
    buf.push({ level: "log", text: "b" })
    buf.push({ level: "log", text: "c" })
    const out = await consoleTool.handler({ since_cursor: 0 }, buf)
    expect(out.dropped).toBeGreaterThan(0)
  })
})

describe("take_screenshot tool", () => {
  test("calls control with window:screenshot and a temp path", async () => {
    let captured: { action: string; data: { path: string } } | null = null
    const control = (action: string, data: unknown) => {
      captured = { action, data: data as { path: string } }
      return Bun.write(captured.data.path, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    }
    const out = await screenshotTool.handler({}, control as any)
    expect(captured).not.toBeNull()
    expect(captured!.action).toBe("window:screenshot")
    expect(captured!.data.path).toContain(tmpdir())
    expect(captured!.data.path.endsWith(".png")).toBe(true)
    expect(out.content[0]!.type).toBe("image")
    expect(out.content[0]!.mimeType).toBe("image/png")
    expect(typeof out.content[0]!.data).toBe("string")
    // Decoded base64 should match the bytes we wrote
    expect(Buffer.from(out.content[0]!.data, "base64")).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  test("temp file is cleaned up after read", async () => {
    let path = ""
    const control = (_: string, data: unknown) => {
      path = (data as { path: string }).path
      return Bun.write(path, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    }
    await screenshotTool.handler({}, control as any)
    expect(await Bun.file(path).exists()).toBe(false)
  })
})

describe("click tool", () => {
  test("sends mcp:eval with click JS", async () => {
    let captured = ""
    const control = (action: string, data: unknown) => {
      expect(action).toBe("mcp:eval")
      captured = (data as { code: string }).code
      return Promise.resolve(JSON.stringify({ ok: true }))
    }
    const out = await clickTool.handler({ selector: "#submit" }, control as any)
    expect(captured).toContain(JSON.stringify("#submit"))
    expect(captured).toContain(".click()")
    expect(out.ok).toBe(true)
  })

  test("returns ok:false with error when no element matches", async () => {
    const control = () =>
      Promise.resolve(JSON.stringify({ error: 'Error: No element matched: "#x"' }))
    const out = await clickTool.handler({ selector: "#x" }, control as any)
    expect(out.ok).toBe(false)
    expect(out.error).toContain("No element matched")
  })

  test("escapes adversarial selector via JSON.stringify", async () => {
    let captured = ""
    const control = (_a: string, d: unknown) => {
      captured = (d as { code: string }).code
      return Promise.resolve(JSON.stringify({ ok: true }))
    }
    const adv = `button[data-x="' or 1=1 --"]`
    await clickTool.handler({ selector: adv }, control as any)
    expect(captured).toContain(JSON.stringify(adv))
  })
})

describe("fill tool", () => {
  test("sends mcp:eval with fill JS, escapes both selector and value", async () => {
    let captured = ""
    const control = (_action: string, data: unknown) => {
      captured = (data as { code: string }).code
      return Promise.resolve(JSON.stringify({ ok: true }))
    }
    await fillTool.handler({ selector: `input[name="q"]`, value: `"oops"` }, control as any)
    expect(captured).toContain(JSON.stringify(`input[name="q"]`))
    expect(captured).toContain(JSON.stringify(`"oops"`))
    expect(captured).toContain(`new Event("input"`)
    expect(captured).toContain(`new Event("change"`)
  })

  test("returns ok:true on success", async () => {
    const control = () => Promise.resolve(JSON.stringify({ ok: true }))
    const out = await fillTool.handler({ selector: "#x", value: "v" }, control as any)
    expect(out.ok).toBe(true)
    expect(out.error).toBeUndefined()
  })

  test("returns ok:false with error on missing element", async () => {
    const control = () =>
      Promise.resolve(JSON.stringify({ error: 'Error: No element matched: "#x"' }))
    const out = await fillTool.handler({ selector: "#x", value: "v" }, control as any)
    expect(out.ok).toBe(false)
    expect(out.error).toContain("No element matched")
  })
})
