import type { IpcMessage } from "../types"
import { encode, decode } from "./protocol"

export type RingBuffer = {
  buffer: Uint8Array
  size: number
  readCursor: number
  writeCursor: number
}

const HEADER_SIZE = 4

export const createRingBuffer = (size: number): RingBuffer => ({
  buffer: new Uint8Array(size),
  size,
  readCursor: 0,
  writeCursor: 0,
})

const available = (ring: RingBuffer): number => {
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

const writeBytes = (ring: RingBuffer, data: Uint8Array): void => {
  for (let i = 0; i < data.length; i++) {
    ring.buffer[ring.writeCursor] = data[i]
    ring.writeCursor = (ring.writeCursor + 1) % ring.size
  }
}

const readBytes = (ring: RingBuffer, length: number): Uint8Array => {
  const result = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    result[i] = ring.buffer[ring.readCursor]
    ring.readCursor = (ring.readCursor + 1) % ring.size
  }
  return result
}

export const writeMessage = (ring: RingBuffer, msg: IpcMessage): boolean => {
  const encoded = encode(msg)
  if (encoded.length > available(ring)) return false
  writeBytes(ring, encoded)
  return true
}

export const readMessage = (ring: RingBuffer): IpcMessage | null => {
  if (used(ring) < HEADER_SIZE) return null

  // Peek at length without advancing cursor
  const savedCursor = ring.readCursor
  const headerBytes = readBytes(ring, HEADER_SIZE)
  const view = new DataView(headerBytes.buffer)
  const payloadLen = view.getUint32(0, true)

  if (used(ring) < payloadLen) {
    ring.readCursor = savedCursor
    return null
  }

  const payload = readBytes(ring, payloadLen)
  const json = new TextDecoder().decode(payload)
  return JSON.parse(json) as IpcMessage
}

export { encode, decode, decodeAll } from "./protocol"
