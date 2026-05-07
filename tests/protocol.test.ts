import { test, expect } from "bun:test"
import {
  encode,
  decode,
  decodeAll,
  encodeFrame,
  decodeFrame,
  encodeChunked,
  FRAME_HEADER_SIZE,
  FLAG_LAST,
} from "../src/ipc/protocol"
import type { IpcMessage } from "../src/types"

test("encode produces length+flags-prefixed JSON buffer", () => {
  const msg: IpcMessage = { id: "1", type: "invoke", action: "greet", data: "hi" }
  const buf = encode(msg)
  const view = new DataView(buf.buffer, buf.byteOffset)
  const len = view.getUint32(0, true)
  const flags = view.getUint32(4, true)
  expect(flags).toBe(FLAG_LAST)
  const json = new TextDecoder().decode(buf.subarray(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + len))
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
  expect(messages[0]!.action).toBe("a")
  expect(messages[1]!.action).toBe("b")
})

test("decode returns bytesRead 0 for incomplete frame header", () => {
  const msg: IpcMessage = { id: "1", type: "invoke", action: "test" }
  const full = encode(msg)
  const partial = full.subarray(0, 4)
  const result = decode(partial, 0)
  expect(result.bytesRead).toBe(0)
  expect(result.message).toBeNull()
})

test("decode returns bytesRead 0 for incomplete frame payload", () => {
  const msg: IpcMessage = { id: "1", type: "invoke", action: "test" }
  const full = encode(msg)
  const partial = full.subarray(0, FRAME_HEADER_SIZE + 3)
  const result = decode(partial, 0)
  expect(result.bytesRead).toBe(0)
  expect(result.message).toBeNull()
})

test("encodeChunked splits oversized payloads into multiple frames", () => {
  const big: IpcMessage = { id: "1", type: "invoke", action: "x", data: "y".repeat(200_000) }
  const frames = encodeChunked(big, 16 * 1024)
  expect(frames.length).toBeGreaterThan(1)
  // only the final frame has FLAG_LAST set
  for (let i = 0; i < frames.length - 1; i++) {
    const v = new DataView(frames[i]!.buffer, frames[i]!.byteOffset)
    expect(v.getUint32(4, true) & FLAG_LAST).toBe(0)
  }
  const last = frames[frames.length - 1]!
  const lastV = new DataView(last.buffer, last.byteOffset)
  expect(lastV.getUint32(4, true) & FLAG_LAST).toBe(FLAG_LAST)
})

test("decodeAll reassembles multi-frame messages", () => {
  const big: IpcMessage = { id: "1", type: "invoke", action: "big", data: "z".repeat(100_000) }
  const frames = encodeChunked(big, 16 * 1024)
  let total = 0
  for (const f of frames) total += f.length
  const combined = new Uint8Array(total)
  let p = 0
  for (const f of frames) {
    combined.set(f, p)
    p += f.length
  }
  const messages = decodeAll(combined)
  expect(messages).toHaveLength(1)
  expect(messages[0]!.action).toBe("big")
  expect((messages[0]!.data as string).length).toBe(100_000)
})

test("encodeFrame / decodeFrame round-trip with arbitrary flags", () => {
  const payload = new TextEncoder().encode("hello world")
  const frame = encodeFrame(payload, 0)
  const parsed = decodeFrame(frame, 0)
  expect(parsed).not.toBeNull()
  expect(parsed!.flags).toBe(0)
  expect(new TextDecoder().decode(parsed!.payload)).toBe("hello world")
})
