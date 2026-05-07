/*
 * Length-prefixed ring buffer with chunked-message support.
 *
 * writeMessage queues a logical message as one or more frames; queued
 * frames are flushed into the ring as space becomes available, so a
 * message that exceeds the ring's capacity is no longer rejected — it
 * streams through across multiple reader drains.
 *
 * readMessage reassembles incoming frames and returns one complete
 * logical message at a time.
 */

import type { IpcMessage } from "../types"
import { encodeChunked, FRAME_HEADER_SIZE, FLAG_LAST } from "./protocol"

const decoder = new TextDecoder()

// Per-frame payload cap. Smaller chunks let the writer make progress when
// the ring is mostly full; larger chunks reduce header overhead. 16KB is
// well under the 64KB-per-direction shared-memory ring used at runtime.
export const DEFAULT_MAX_CHUNK_PAYLOAD = 16 * 1024

export type RingBuffer = {
  buffer: Uint8Array
  size: number
  readCursor: number
  writeCursor: number
  pendingWrite: { bytes: Uint8Array; offset: number }[]
  reassembly: Uint8Array[]
  reassemblyLen: number
  maxChunkPayload: number
}

export const createRingBuffer = (size: number, maxChunkPayload?: number): RingBuffer => {
  // A ring of size R can hold at most R-1 bytes simultaneously. Each frame
  // adds FRAME_HEADER_SIZE bytes of overhead. Cap chunks well under R so
  // a frame fits entirely in the ring even when the reader hasn't drained
  // yet — otherwise reader and writer can deadlock on a single oversized
  // frame.
  const cap = Math.max(1, size - FRAME_HEADER_SIZE - 1)
  const auto = Math.max(1, Math.min(DEFAULT_MAX_CHUNK_PAYLOAD, Math.floor(cap / 2)))
  const chunk = Math.max(1, Math.min(maxChunkPayload ?? auto, cap))
  return {
    buffer: new Uint8Array(size),
    size,
    readCursor: 0,
    writeCursor: 0,
    pendingWrite: [],
    reassembly: [],
    reassemblyLen: 0,
    maxChunkPayload: chunk,
  }
}

const free = (ring: RingBuffer): number => {
  if (ring.writeCursor >= ring.readCursor) {
    return ring.size - (ring.writeCursor - ring.readCursor) - 1
  }
  return ring.readCursor - ring.writeCursor - 1
}

const used = (ring: RingBuffer): number => {
  if (ring.writeCursor >= ring.readCursor) {
    return ring.writeCursor - ring.readCursor
  }
  return ring.size - ring.readCursor + ring.writeCursor
}

const writeBytes = (ring: RingBuffer, data: Uint8Array, length: number): void => {
  const tail = ring.size - ring.writeCursor
  if (length <= tail) {
    ring.buffer.set(data.subarray(0, length), ring.writeCursor)
  } else {
    ring.buffer.set(data.subarray(0, tail), ring.writeCursor)
    ring.buffer.set(data.subarray(tail, length), 0)
  }
  ring.writeCursor = (ring.writeCursor + length) % ring.size
}

const readBytes = (ring: RingBuffer, length: number): Uint8Array => {
  const tail = ring.size - ring.readCursor
  let result: Uint8Array
  if (length <= tail) {
    result = ring.buffer.slice(ring.readCursor, ring.readCursor + length)
  } else {
    result = new Uint8Array(length)
    result.set(ring.buffer.subarray(ring.readCursor, ring.size), 0)
    result.set(ring.buffer.subarray(0, length - tail), tail)
  }
  ring.readCursor = (ring.readCursor + length) % ring.size
  return result
}

const flushPending = (ring: RingBuffer): boolean => {
  let anyWritten = false
  while (ring.pendingWrite.length > 0) {
    const item = ring.pendingWrite[0]!
    const remaining = item.bytes.length - item.offset
    if (remaining <= 0) {
      ring.pendingWrite.shift()
      continue
    }
    const space = free(ring)
    if (space === 0) break
    const toWrite = Math.min(remaining, space)
    writeBytes(ring, item.bytes.subarray(item.offset), toWrite)
    item.offset += toWrite
    anyWritten = true
    if (item.offset >= item.bytes.length) {
      ring.pendingWrite.shift()
    } else {
      // Ring is full; cannot write more this round.
      break
    }
  }
  return anyWritten
}

// Queue a logical message and write as many bytes as fit. Always returns
// true: any frames that don't fit stay queued and are flushed by future
// flushWrites/writeMessage calls. Use pendingFrameCount to detect
// back-pressure when callers want to throttle.
export const writeMessage = (ring: RingBuffer, msg: IpcMessage): boolean => {
  const frames = encodeChunked(msg, ring.maxChunkPayload)
  for (const frame of frames) {
    ring.pendingWrite.push({ bytes: frame, offset: 0 })
  }
  flushPending(ring)
  return true
}

// Push any queued frames into the ring; useful after the reader has drained
// and freed space. Returns true if at least one byte was written.
export const flushWrites = (ring: RingBuffer): boolean => flushPending(ring)

export const pendingFrameCount = (ring: RingBuffer): number => ring.pendingWrite.length

// Read one complete logical message, reassembling chunked frames as needed.
// Returns null when the next message is not yet fully present.
export const readMessage = (ring: RingBuffer): IpcMessage | null => {
  while (used(ring) >= FRAME_HEADER_SIZE) {
    const savedCursor = ring.readCursor
    const header = readBytes(ring, FRAME_HEADER_SIZE)
    const view = new DataView(header.buffer)
    const len = view.getUint32(0, true)
    const flags = view.getUint32(4, true)

    if (used(ring) < len) {
      ring.readCursor = savedCursor
      return null
    }

    const payload = readBytes(ring, len)
    ring.reassembly.push(payload)
    ring.reassemblyLen += payload.length

    if (flags & FLAG_LAST) {
      const merged = new Uint8Array(ring.reassemblyLen)
      let p = 0
      for (const chunk of ring.reassembly) {
        merged.set(chunk, p)
        p += chunk.length
      }
      ring.reassembly = []
      ring.reassemblyLen = 0
      try {
        return JSON.parse(decoder.decode(merged)) as IpcMessage
      } catch {
        // malformed; fall through and try the next frame
        continue
      }
    }
  }
  return null
}

export {
  encode,
  decode,
  decodeAll,
  encodeFrame,
  encodeChunked,
  decodeFrame,
  FRAME_HEADER_SIZE,
  FLAG_LAST,
} from "./protocol"
