import type { IpcMessage } from "../types"

const HEADER_SIZE = 4

export const encode = (msg: IpcMessage): Uint8Array => {
  const json = JSON.stringify(msg)
  const payload = new TextEncoder().encode(json)
  const buf = new Uint8Array(HEADER_SIZE + payload.length)
  const view = new DataView(buf.buffer)
  view.setUint32(0, payload.length, true)
  buf.set(payload, HEADER_SIZE)
  return buf
}

export const decode = (
  buf: Uint8Array,
  offset: number,
): { message: IpcMessage | null; bytesRead: number } => {
  if (buf.length - offset < HEADER_SIZE) return { message: null, bytesRead: 0 }

  const view = new DataView(buf.buffer, buf.byteOffset + offset)
  const len = view.getUint32(0, true)

  if (buf.length - offset < HEADER_SIZE + len) return { message: null, bytesRead: 0 }

  const json = new TextDecoder().decode(
    buf.subarray(offset + HEADER_SIZE, offset + HEADER_SIZE + len),
  )
  const message = JSON.parse(json) as IpcMessage
  return { message, bytesRead: HEADER_SIZE + len }
}

export const decodeAll = (buf: Uint8Array): IpcMessage[] => {
  const messages: IpcMessage[] = []
  let offset = 0
  while (offset < buf.length) {
    const { message, bytesRead } = decode(buf, offset)
    if (!message) break
    messages.push(message)
    offset += bytesRead
  }
  return messages
}
