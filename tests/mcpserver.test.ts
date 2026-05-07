import { test, expect, describe } from "bun:test"
import { createMcpServer } from "../src/mcp"

describe("createMcpServer", () => {
  test("returns object with start, stop, recordConsole, readConsole, listTools", () => {
    const srv = createMcpServer({
      port: 0,
      consoleBuffer: 10,
      control: () => Promise.resolve(""),
    })
    expect(typeof srv.start).toBe("function")
    expect(typeof srv.stop).toBe("function")
    expect(typeof srv.recordConsole).toBe("function")
    expect(typeof srv.readConsole).toBe("function")
    expect(typeof srv.listTools).toBe("function")
  })

  test("recordConsole pushes to the buffer; readConsole returns it", () => {
    const srv = createMcpServer({
      port: 0,
      consoleBuffer: 10,
      control: () => Promise.resolve(""),
    })
    srv.recordConsole({ level: "log", text: "hello" })
    const out = srv.readConsole()
    expect(out.messages).toHaveLength(1)
    expect(out.messages[0]!.text).toBe("hello")
  })

  test("listTools returns all 5 tool definitions with names", () => {
    const srv = createMcpServer({ port: 0, consoleBuffer: 10, control: () => Promise.resolve("") })
    const tools = srv.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining(["eval_javascript", "list_console_messages", "take_screenshot", "click", "fill"])
    )
    expect(names).toHaveLength(5)
  })

  // Regression: Butter's MCP transport used to crash with
  // "Stateless transport cannot be reused across requests" on the second
  // request. A fresh transport is now created per request.
  test("handles multiple sequential requests on the same instance", async () => {
    const port = 4700 + Math.floor(Math.random() * 100)
    const srv = createMcpServer({
      port,
      consoleBuffer: 10,
      control: () => Promise.resolve(""),
    })
    await srv.start()
    try {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      }
      const body = (id: number) => JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/list",
      })

      const r1 = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers,
        body: body(1),
      })
      expect(r1.ok).toBe(true)

      const r2 = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers,
        body: body(2),
      })
      expect(r2.ok).toBe(true)

      const r3 = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers,
        body: body(3),
      })
      expect(r3.ok).toBe(true)
    } finally {
      await srv.stop()
    }
  })
})
