import { test, expect, describe } from "bun:test"
import { createConsoleBuffer } from "../src/mcp/console"

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
