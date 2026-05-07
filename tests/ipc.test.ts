import { test, expect } from "bun:test"
import {
  createRingBuffer,
  writeMessage,
  readMessage,
  flushWrites,
  pendingFrameCount,
} from "../src/ipc"
import type { IpcMessage } from "../src/types"

test("createRingBuffer creates buffer with correct size", () => {
  const ring = createRingBuffer(1024)
  expect(ring.size).toBe(1024)
  expect(ring.readCursor).toBe(0)
  expect(ring.writeCursor).toBe(0)
})

test("writeMessage and readMessage roundtrip", () => {
  const ring = createRingBuffer(4096)
  const msg: IpcMessage = { id: "1", type: "invoke", action: "greet", data: "hello" }

  writeMessage(ring, msg)
  expect(pendingFrameCount(ring)).toBe(0)

  const result = readMessage(ring)
  expect(result).toEqual(msg)
})

test("readMessage returns null on empty buffer", () => {
  const ring = createRingBuffer(4096)
  const result = readMessage(ring)
  expect(result).toBeNull()
})

test("multiple messages roundtrip in order", () => {
  const ring = createRingBuffer(4096)
  const msgs: IpcMessage[] = [
    { id: "1", type: "invoke", action: "a" },
    { id: "2", type: "invoke", action: "b" },
    { id: "3", type: "invoke", action: "c" },
  ]

  for (const msg of msgs) writeMessage(ring, msg)

  for (const msg of msgs) {
    const result = readMessage(ring)
    expect(result).toEqual(msg)
  }
})

test("messages larger than ring capacity stream through chunked", () => {
  // 64-byte ring is far too small for the message; chunks will queue
  // and only flush as the reader drains.
  const ring = createRingBuffer(256)
  const big: IpcMessage = {
    id: "1",
    type: "invoke",
    action: "big",
    data: "x".repeat(10_000),
  }
  writeMessage(ring, big)
  // Not all frames could fit immediately; queue should be non-empty.
  expect(pendingFrameCount(ring)).toBeGreaterThan(0)

  // Drain: read what we can, flush more, repeat until reassembly completes.
  let received: IpcMessage | null = null
  for (let i = 0; i < 1000 && received === null; i++) {
    received = readMessage(ring)
    flushWrites(ring)
  }
  expect(received).toEqual(big)
  expect(pendingFrameCount(ring)).toBe(0)
})

test("ring buffer wraps around correctly", () => {
  const ring = createRingBuffer(256)
  for (let i = 0; i < 20; i++) {
    const msg: IpcMessage = { id: String(i), type: "invoke", action: "test" }
    writeMessage(ring, msg)
    const result = readMessage(ring)
    expect(result).toEqual(msg)
  }
})
