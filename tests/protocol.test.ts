import { test, expect } from "bun:test"
import { encode, decode, decodeAll } from "../src/ipc/protocol"
import type { IpcMessage } from "../src/types"

test("encode produces length-prefixed JSON buffer", () => {
  const msg: IpcMessage = { id: "1", type: "invoke", action: "greet", data: "hi" }
  const buf = encode(msg)
  const view = new DataView(buf.buffer, buf.byteOffset)
  const len = view.getUint32(0, true)
  const json = new TextDecoder().decode(buf.subarray(4, 4 + len))
  expect(JSON.parse(json)).toEqual(msg)
})

test("decode reads a single message from buffer at offset", () => {
  const msg: IpcMessage = { id: "2", type: "response", action: "greet", data: "hello" }
  const buf = encode(msg)
  const result = decode(buf, 0)
  expect(result.message).toEqual(msg)
  expect(result.bytesRead).toBe(buf.length)
})

test("encode then decode roundtrips", () => {
  const msg: IpcMessage = { id: "3", type: "event", action: "status", data: { ok: true } }
  const buf = encode(msg)
  const { message } = decode(buf, 0)
  expect(message).toEqual(msg)
})

test("decodeAll reads multiple messages from buffer", () => {
  const msg1: IpcMessage = { id: "1", type: "invoke", action: "a" }
  const msg2: IpcMessage = { id: "2", type: "invoke", action: "b" }
  const combined = new Uint8Array([...encode(msg1), ...encode(msg2)])
  const messages = decodeAll(combined)
  expect(messages).toHaveLength(2)
  expect(messages[0].action).toBe("a")
  expect(messages[1].action).toBe("b")
})

test("decode returns bytesRead 0 for incomplete message", () => {
  const msg: IpcMessage = { id: "1", type: "invoke", action: "test" }
  const full = encode(msg)
  const partial = full.subarray(0, 6)
  const result = decode(partial, 0)
  expect(result.bytesRead).toBe(0)
  expect(result.message).toBeNull()
})
