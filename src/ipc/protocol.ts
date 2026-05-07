/*
 * Wire-level frame protocol.
 *
 * Each frame on the wire is:
 *   [len:u32 LE][flags:u32 LE][payload:bytes]
 *
 * A logical message may span multiple consecutive frames. The final frame
 * has FLAG_LAST set; all preceding frames carry FLAG_LAST=0. Single-frame
 * messages just have FLAG_LAST=1. Order is preserved by the underlying
 * single-producer/single-consumer ring, so chunks need no message id.
 *
 * This format replaces the original 4-byte length-only header. The change
 * unblocks payloads larger than the ring buffer (previously truncated
 * silently when a single message exceeded ~64KB).
 */

import type { IpcMessage } from "../types"

export const FRAME_HEADER_SIZE = 8
export const FLAG_LAST = 1 << 0

// Module-level codecs — TextEncoder/TextDecoder are not free to construct,
// and IPC encode/decode is in the hot path.
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const encodeFrame = (payload: Uint8Array, flags: number): Uint8Array => {
  const buf = new Uint8Array(FRAME_HEADER_SIZE + payload.length)
  const view = new DataView(buf.buffer)
  view.setUint32(0, payload.length, true)
  view.setUint32(4, flags, true)
  buf.set(payload, FRAME_HEADER_SIZE)
  return buf
}

// Encode a logical message as a single frame. Convenient when the caller
// knows the payload is small enough to never need chunking; otherwise use
// encodeChunked.
export const encode = (msg: IpcMessage): Uint8Array => {
  const json = JSON.stringify(msg)
  const payload = encoder.encode(json)
  return encodeFrame(payload, FLAG_LAST)
}

// Encode a logical message into one or more frames. Each frame's payload
// is at most maxPayload bytes; the final frame carries FLAG_LAST. An empty
// JSON payload still produces one frame.
export const encodeChunked = (msg: IpcMessage, maxPayload: number): Uint8Array[] => {
  if (maxPayload <= 0) throw new Error("maxPayload must be positive")
  const json = JSON.stringify(msg)
  const payload = encoder.encode(json)
  if (payload.length === 0) return [encodeFrame(payload, FLAG_LAST)]

  const frames: Uint8Array[] = []
  let offset = 0
  while (offset < payload.length) {
    const remaining = payload.length - offset
    const chunkLen = Math.min(remaining, maxPayload)
    const isLast = offset + chunkLen >= payload.length
    frames.push(encodeFrame(payload.subarray(offset, offset + chunkLen), isLast ? FLAG_LAST : 0))
    offset += chunkLen
  }
  return frames
}

export type Frame = { payload: Uint8Array; flags: number; bytesRead: number }

export const decodeFrame = (buf: Uint8Array, offset: number): Frame | null => {
  if (buf.length - offset < FRAME_HEADER_SIZE) return null
  const view = new DataView(buf.buffer, buf.byteOffset + offset)
  const len = view.getUint32(0, true)
  const flags = view.getUint32(4, true)
  if (buf.length - offset < FRAME_HEADER_SIZE + len) return null
  const payload = buf.subarray(offset + FRAME_HEADER_SIZE, offset + FRAME_HEADER_SIZE + len)
  return { payload, flags, bytesRead: FRAME_HEADER_SIZE + len }
}

// Convenience: decode a single complete-in-one-frame message. Returns null
// if the frame is incomplete OR if the frame is a non-final chunk (callers
// that need chunking support should drive decodeFrame + reassembly directly).
export const decode = (
  buf: Uint8Array,
  offset: number,
): { message: IpcMessage | null; bytesRead: number } => {
  const frame = decodeFrame(buf, offset)
  if (!frame) return { message: null, bytesRead: 0 }
  if (!(frame.flags & FLAG_LAST)) return { message: null, bytesRead: frame.bytesRead }
  try {
    const message = JSON.parse(decoder.decode(frame.payload)) as IpcMessage
    return { message, bytesRead: frame.bytesRead }
  } catch {
    return { message: null, bytesRead: frame.bytesRead }
  }
}

// Parse all complete logical messages from a contiguous buffer, reassembling
// any chunked sequences in order. Trailing partial frames are ignored.
export const decodeAll = (buf: Uint8Array): IpcMessage[] => {
  const messages: IpcMessage[] = []
  let pending: Uint8Array[] = []
  let pendingLen = 0
  let offset = 0
  while (offset < buf.length) {
    const frame = decodeFrame(buf, offset)
    if (!frame) break
    pending.push(frame.payload)
    pendingLen += frame.payload.length
    offset += frame.bytesRead
    if (frame.flags & FLAG_LAST) {
      const merged = mergeChunks(pending, pendingLen)
      pending = []
      pendingLen = 0
      try {
        messages.push(JSON.parse(decoder.decode(merged)) as IpcMessage)
      } catch {
        // skip malformed
      }
    }
  }
  return messages
}

const mergeChunks = (chunks: Uint8Array[], totalLen: number): Uint8Array => {
  const merged = new Uint8Array(totalLen)
  let p = 0
  for (const chunk of chunks) {
    merged.set(chunk, p)
    p += chunk.length
  }
  return merged
}
