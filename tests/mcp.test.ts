import { test, expect, describe } from "bun:test"
import { createConsoleBuffer } from "../src/mcp/console"
import { wrapEval, wrapClick, wrapFill } from "../src/mcp/wrap"
import { evalTool } from "../src/mcp/tools/eval"

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
