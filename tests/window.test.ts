import { test, expect, describe, beforeEach } from "bun:test"
import { createRuntime } from "../src/runtime"

describe("createWindow", () => {
  test("returns a unique windowId string", () => {
    const rt = createRuntime()
    const id = rt.createWindow({ url: "http://localhost:3000" })
    expect(typeof id).toBe("string")
    expect(id.length).toBeGreaterThan(0)
  })

  test("queues a control message with correct shape", () => {
    const rt = createRuntime()
    rt.createWindow({ url: "http://localhost:3000" })
    const msgs = rt.drainOutgoing()
    expect(msgs).toHaveLength(1)
    expect(msgs[0].type).toBe("control")
    expect(msgs[0].action).toBe("window:create")
    expect(msgs[0].data).toHaveProperty("windowId")
    expect(msgs[0].data).toHaveProperty("url", "http://localhost:3000")
  })

  test("multiple calls produce incrementing ids", () => {
    const rt = createRuntime()
    const id1 = rt.createWindow({ url: "http://a.com" })
    const id2 = rt.createWindow({ url: "http://b.com" })
    const id3 = rt.createWindow({ url: "http://c.com" })
    expect(id1).not.toBe(id2)
    expect(id2).not.toBe(id3)
    expect(Number(id2)).toBe(Number(id1) + 1)
    expect(Number(id3)).toBe(Number(id2) + 1)
  })

  test("passes all options through to the control message", () => {
    const rt = createRuntime()
    const opts = {
      url: "http://localhost:5173",
      title: "Secondary Window",
      width: 1024,
      height: 768,
      x: 100,
      y: 200,
      frameless: true,
      transparent: true,
      alwaysOnTop: true,
      modal: true,
    }
    const windowId = rt.createWindow(opts)
    const msgs = rt.drainOutgoing()
    const data = msgs[0].data as Record<string, unknown>
    expect(data.windowId).toBe(windowId)
    expect(data.url).toBe("http://localhost:5173")
    expect(data.title).toBe("Secondary Window")
    expect(data.width).toBe(1024)
    expect(data.height).toBe(768)
    expect(data.x).toBe(100)
    expect(data.y).toBe(200)
    expect(data.frameless).toBe(true)
    expect(data.transparent).toBe(true)
    expect(data.alwaysOnTop).toBe(true)
    expect(data.modal).toBe(true)
  })

  test("each message gets a unique message id", () => {
    const rt = createRuntime()
    rt.createWindow({ url: "http://a.com" })
    rt.createWindow({ url: "http://b.com" })
    const msgs = rt.drainOutgoing()
    expect(msgs[0].id).not.toBe(msgs[1].id)
  })

  test("with minimal options only includes url", () => {
    const rt = createRuntime()
    rt.createWindow({ url: "http://localhost:3000" })
    const msgs = rt.drainOutgoing()
    const data = msgs[0].data as Record<string, unknown>
    expect(data.url).toBe("http://localhost:3000")
    expect(data.title).toBeUndefined()
    expect(data.frameless).toBeUndefined()
  })
})

describe("sendChunk", () => {
  test("queues a response message with chunk data", () => {
    const rt = createRuntime()
    rt.sendChunk("req-1", { progress: 50 })
    const msgs = rt.drainOutgoing()
    expect(msgs).toHaveLength(1)
    expect(msgs[0].type).toBe("response")
    expect(msgs[0].action).toBe("chunk")
    const data = msgs[0].data as Record<string, unknown>
    expect(data.id).toBe("req-1")
    expect(data.type).toBe("chunk")
    expect(data.data).toEqual({ progress: 50 })
  })

  test("works with string data", () => {
    const rt = createRuntime()
    rt.sendChunk("req-2", "partial result")
    const msgs = rt.drainOutgoing()
    const data = msgs[0].data as Record<string, unknown>
    expect(data.data).toBe("partial result")
  })

  test("works with numeric data", () => {
    const rt = createRuntime()
    rt.sendChunk("req-3", 42)
    const msgs = rt.drainOutgoing()
    const data = msgs[0].data as Record<string, unknown>
    expect(data.data).toBe(42)
  })

  test("works with null data", () => {
    const rt = createRuntime()
    rt.sendChunk("req-4", null)
    const msgs = rt.drainOutgoing()
    const data = msgs[0].data as Record<string, unknown>
    expect(data.data).toBeNull()
  })

  test("works with array data", () => {
    const rt = createRuntime()
    rt.sendChunk("req-5", [1, 2, 3])
    const msgs = rt.drainOutgoing()
    const data = msgs[0].data as Record<string, unknown>
    expect(data.data).toEqual([1, 2, 3])
  })
})

describe("drainOutgoing", () => {
  test("returns and clears all queued messages", () => {
    const rt = createRuntime()
    rt.send("event:a", 1)
    rt.send("event:b", 2)
    rt.send("event:c", 3)
    const first = rt.drainOutgoing()
    expect(first).toHaveLength(3)
    const second = rt.drainOutgoing()
    expect(second).toHaveLength(0)
  })

  test("returns empty array when nothing is queued", () => {
    const rt = createRuntime()
    const msgs = rt.drainOutgoing()
    expect(msgs).toEqual([])
  })

  test("includes messages from mixed sources", () => {
    const rt = createRuntime()
    rt.send("event:ping", null)
    rt.createWindow({ url: "http://localhost" })
    rt.sendChunk("req-1", "data")
    const msgs = rt.drainOutgoing()
    expect(msgs).toHaveLength(3)
    expect(msgs[0].type).toBe("event")
    expect(msgs[1].type).toBe("control")
    expect(msgs[2].type).toBe("response")
  })
})

describe("control", () => {
  beforeEach(() => {
    globalThis.__butterPendingControls = undefined
  })

  test("returns a promise", () => {
    const rt = createRuntime()
    const result = rt.control("window:maximize")
    expect(result).toBeInstanceOf(Promise)
  })

  test("queues a control message", () => {
    const rt = createRuntime()
    rt.control("window:maximize")
    const msgs = rt.drainOutgoing()
    expect(msgs).toHaveLength(1)
    expect(msgs[0].type).toBe("control")
    expect(msgs[0].action).toBe("window:maximize")
  })

  test("queues control message with data", () => {
    const rt = createRuntime()
    rt.control("window:fullscreen", { enable: true })
    const msgs = rt.drainOutgoing()
    expect(msgs[0].data).toEqual({ enable: true })
  })

  test("stores the resolve callback in __butterPendingControls", () => {
    const rt = createRuntime()
    rt.control("window:minimize")
    expect(globalThis.__butterPendingControls).toBeDefined()
    expect(globalThis.__butterPendingControls!.size).toBe(1)
  })

  test("multiple control calls store multiple pending entries", () => {
    const rt = createRuntime()
    rt.control("window:maximize")
    rt.control("window:minimize")
    rt.control("window:restore")
    expect(globalThis.__butterPendingControls!.size).toBe(3)
  })
})

describe("resolveControl", () => {
  beforeEach(() => {
    globalThis.__butterPendingControls = undefined
  })

  test("resolves a pending control promise", async () => {
    const rt = createRuntime()
    const promise = rt.control("window:maximize")
    const msgs = rt.drainOutgoing()
    const id = msgs[0].id
    rt.resolveControl(id, { success: true })
    const result = await promise
    expect(result).toEqual({ success: true })
  })

  test("removes the entry after resolving", async () => {
    const rt = createRuntime()
    const promise = rt.control("window:maximize")
    const msgs = rt.drainOutgoing()
    const id = msgs[0].id
    rt.resolveControl(id, "done")
    await promise
    expect(globalThis.__butterPendingControls!.has(id)).toBe(false)
  })

  test("does nothing for unknown id", () => {
    const rt = createRuntime()
    rt.resolveControl("nonexistent-id", "data")
    // should not throw
  })

  test("resolves only the matching control", async () => {
    const rt = createRuntime()
    const p1 = rt.control("window:maximize")
    const p2 = rt.control("window:minimize")
    const msgs = rt.drainOutgoing()
    const id1 = msgs[0].id
    rt.resolveControl(id1, "maximized")
    const result1 = await p1
    expect(result1).toBe("maximized")
    expect(globalThis.__butterPendingControls!.size).toBe(1)
    // p2 is still pending
    const id2 = msgs[1].id
    rt.resolveControl(id2, "minimized")
    const result2 = await p2
    expect(result2).toBe("minimized")
  })
})

describe("setWindow", () => {
  test("updates local window state", () => {
    const rt = createRuntime()
    rt.setWindow({ title: "Updated" })
    expect(rt.getWindow().title).toBe("Updated")
  })

  test("preserves unmodified fields", () => {
    const rt = createRuntime()
    rt.setWindow({ title: "New" })
    expect(rt.getWindow().width).toBe(800)
    expect(rt.getWindow().height).toBe(600)
  })

  test("can update multiple fields at once", () => {
    const rt = createRuntime()
    rt.setWindow({ title: "Big", width: 1920, height: 1080 })
    const win = rt.getWindow()
    expect(win.title).toBe("Big")
    expect(win.width).toBe(1920)
    expect(win.height).toBe(1080)
  })

  test("successive calls accumulate changes", () => {
    const rt = createRuntime()
    rt.setWindow({ title: "Step 1" })
    rt.setWindow({ width: 1024 })
    rt.setWindow({ height: 768 })
    const win = rt.getWindow()
    expect(win.title).toBe("Step 1")
    expect(win.width).toBe(1024)
    expect(win.height).toBe(768)
  })
})

describe("getWindow", () => {
  test("returns default state for fresh runtime", () => {
    const rt = createRuntime()
    const win = rt.getWindow()
    expect(win.title).toBe("Butter App")
    expect(win.width).toBe(800)
    expect(win.height).toBe(600)
  })

  test("respects initialWindow override", () => {
    const rt = createRuntime({ title: "Custom", width: 1200, height: 900 })
    const win = rt.getWindow()
    expect(win.title).toBe("Custom")
    expect(win.width).toBe(1200)
    expect(win.height).toBe(900)
  })

  test("returns a copy, not a reference", () => {
    const rt = createRuntime()
    const win1 = rt.getWindow()
    win1.title = "Mutated"
    const win2 = rt.getWindow()
    expect(win2.title).toBe("Butter App")
  })
})

describe("createRuntime with initialWindow", () => {
  test("partial initial window fills defaults for missing fields", () => {
    const rt = createRuntime({ title: "Partial" })
    const win = rt.getWindow()
    expect(win.title).toBe("Partial")
    expect(win.width).toBe(800)
    expect(win.height).toBe(600)
  })

  test("empty initial window uses all defaults", () => {
    const rt = createRuntime({})
    const win = rt.getWindow()
    expect(win.title).toBe("Butter App")
    expect(win.width).toBe(800)
    expect(win.height).toBe(600)
  })
})

describe("message id uniqueness across operations", () => {
  test("send, createWindow, sendChunk, and control all get unique ids", () => {
    const rt = createRuntime()
    globalThis.__butterPendingControls = undefined
    rt.send("event:a", null)
    rt.createWindow({ url: "http://localhost" })
    rt.sendChunk("req-1", "chunk")
    rt.control("window:maximize")
    const msgs = rt.drainOutgoing()
    const ids = msgs.map((m) => m.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})
