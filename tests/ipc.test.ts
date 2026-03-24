import { test, expect } from "bun:test"
import { createRingBuffer, writeMessage, readMessage } from "../src/ipc"
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

  const written = writeMessage(ring, msg)
  expect(written).toBe(true)

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

test("writeMessage returns false when buffer is full", () => {
  const ring = createRingBuffer(64)
  const bigMsg: IpcMessage = {
    id: "1",
    type: "invoke",
    action: "x".repeat(100),
  }
  const written = writeMessage(ring, bigMsg)
  expect(written).toBe(false)
})

test("ring buffer wraps around correctly", () => {
  const ring = createRingBuffer(256)
  for (let i = 0; i < 20; i++) {
    const msg: IpcMessage = { id: String(i), type: "invoke", action: "test" }
    const written = writeMessage(ring, msg)
    expect(written).toBe(true)
    const result = readMessage(ring)
    expect(result).toEqual(msg)
  }
})
