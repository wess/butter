import { test, expect, describe } from "bun:test"
import { createRuntime } from "../src/runtime"

describe("streaming via sendChunk", () => {
  test("multiple sendChunk calls queue multiple response messages", () => {
    const rt = createRuntime()
    rt.sendChunk("req-1", "chunk-a")
    rt.sendChunk("req-1", "chunk-b")
    rt.sendChunk("req-1", "chunk-c")
    const msgs = rt.drainOutgoing()
    expect(msgs).toHaveLength(3)
    for (const msg of msgs) {
      expect(msg.type).toBe("response")
      expect(msg.action).toBe("chunk")
      const data = msg.data as Record<string, unknown>
      expect(data.id).toBe("req-1")
      expect(data.type).toBe("chunk")
    }
    const chunks = msgs.map((m) => (m.data as Record<string, unknown>).data)
    expect(chunks).toEqual(["chunk-a", "chunk-b", "chunk-c"])
  })

  test("handler that sends multiple chunks produces correct outgoing", () => {
    const rt = createRuntime()
    rt.on("stream:data", (data) => {
      const { requestId, count } = data as { requestId: string; count: number }
      for (let i = 0; i < count; i++) {
        rt.sendChunk(requestId, { index: i, total: count })
      }
      return { done: true }
    })
    const result = rt.dispatch("stream:data", { requestId: "stream-1", count: 5 })
    expect(result).toEqual({ done: true })
    const msgs = rt.drainOutgoing()
    expect(msgs).toHaveLength(5)
    for (let i = 0; i < 5; i++) {
      const data = msgs[i].data as Record<string, unknown>
      expect(data.id).toBe("stream-1")
      expect(data.data).toEqual({ index: i, total: 5 })
    }
  })

  test("chunks for different request ids are kept separate", () => {
    const rt = createRuntime()
    rt.sendChunk("req-a", "data-a-1")
    rt.sendChunk("req-b", "data-b-1")
    rt.sendChunk("req-a", "data-a-2")
    rt.sendChunk("req-b", "data-b-2")
    const msgs = rt.drainOutgoing()
    expect(msgs).toHaveLength(4)
    const reqAChunks = msgs
      .filter((m) => (m.data as Record<string, unknown>).id === "req-a")
      .map((m) => (m.data as Record<string, unknown>).data)
    const reqBChunks = msgs
      .filter((m) => (m.data as Record<string, unknown>).id === "req-b")
      .map((m) => (m.data as Record<string, unknown>).data)
    expect(reqAChunks).toEqual(["data-a-1", "data-a-2"])
    expect(reqBChunks).toEqual(["data-b-1", "data-b-2"])
  })

  test("sendChunk with object data preserves structure", () => {
    const rt = createRuntime()
    const payload = { nested: { deep: [1, 2, 3] }, flag: true }
    rt.sendChunk("req-1", payload)
    const msgs = rt.drainOutgoing()
    const data = msgs[0].data as Record<string, unknown>
    expect(data.data).toEqual(payload)
  })

  test("sendChunk with empty string data", () => {
    const rt = createRuntime()
    rt.sendChunk("req-1", "")
    const msgs = rt.drainOutgoing()
    const data = msgs[0].data as Record<string, unknown>
    expect(data.data).toBe("")
  })

  test("sendChunk with undefined data", () => {
    const rt = createRuntime()
    rt.sendChunk("req-1", undefined)
    const msgs = rt.drainOutgoing()
    const data = msgs[0].data as Record<string, unknown>
    expect(data.data).toBeUndefined()
  })

  test("sendChunk with boolean data", () => {
    const rt = createRuntime()
    rt.sendChunk("req-1", false)
    const msgs = rt.drainOutgoing()
    const data = msgs[0].data as Record<string, unknown>
    expect(data.data).toBe(false)
  })

  test("chunks are interleaved correctly with other message types", () => {
    const rt = createRuntime()
    rt.send("event:start", null)
    rt.sendChunk("req-1", "chunk-1")
    rt.createWindow({ url: "http://localhost" })
    rt.sendChunk("req-1", "chunk-2")
    rt.send("event:end", null)
    const msgs = rt.drainOutgoing()
    expect(msgs).toHaveLength(5)
    expect(msgs[0].type).toBe("event")
    expect(msgs[1].type).toBe("response")
    expect(msgs[2].type).toBe("control")
    expect(msgs[3].type).toBe("response")
    expect(msgs[4].type).toBe("event")
  })

  test("each chunk gets a unique message id", () => {
    const rt = createRuntime()
    rt.sendChunk("req-1", "a")
    rt.sendChunk("req-1", "b")
    rt.sendChunk("req-1", "c")
    const msgs = rt.drainOutgoing()
    const ids = msgs.map((m) => m.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(3)
  })

  test("large number of chunks", () => {
    const rt = createRuntime()
    const count = 1000
    for (let i = 0; i < count; i++) {
      rt.sendChunk("bulk", i)
    }
    const msgs = rt.drainOutgoing()
    expect(msgs).toHaveLength(count)
    const values = msgs.map((m) => (m.data as Record<string, unknown>).data)
    for (let i = 0; i < count; i++) {
      expect(values[i]).toBe(i)
    }
  })
})
