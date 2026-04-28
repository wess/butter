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
})
