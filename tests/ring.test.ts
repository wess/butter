import { test, expect, describe } from "bun:test";
import type { IpcMessage } from "../src/types";

// Replicate ring buffer constants and functions from src/cli/dev.ts
// (they are module-local and cannot be imported)

const SHM_SIZE = 128 * 1024;
const HEADER_SIZE = 64;
const RING_SIZE = (SHM_SIZE - HEADER_SIZE) / 2;
const TO_BUN_OFFSET = HEADER_SIZE;
const TO_SHIM_OFFSET = HEADER_SIZE + RING_SIZE;

const readU32 = (buf: Uint8Array, offset: number): number => {
  const view = new DataView(buf.buffer, buf.byteOffset + offset);
  return view.getUint32(0, true);
};

const writeU32 = (buf: Uint8Array, offset: number, value: number): void => {
  const view = new DataView(buf.buffer, buf.byteOffset + offset);
  view.setUint32(0, value, true);
};

const ringAvailable = (w: number, r: number): number =>
  w >= r ? w - r : RING_SIZE - r + w;

const ringFree = (w: number, r: number): number =>
  r > w ? r - w - 1 : RING_SIZE - (w - r) - 1;

const readByte = (buf: Uint8Array, base: number, cursor: number): number =>
  buf[base + (cursor % RING_SIZE)];

const writeByte = (buf: Uint8Array, base: number, cursor: number, value: number): void => {
  buf[base + (cursor % RING_SIZE)] = value;
};

const readFromShim = (buf: Uint8Array): IpcMessage[] => {
  const messages: IpcMessage[] = [];
  let w = readU32(buf, 0);
  let r = readU32(buf, 4);

  while (ringAvailable(w, r) >= 4) {
    const b0 = readByte(buf, TO_BUN_OFFSET, r);
    const b1 = readByte(buf, TO_BUN_OFFSET, r + 1);
    const b2 = readByte(buf, TO_BUN_OFFSET, r + 2);
    const b3 = readByte(buf, TO_BUN_OFFSET, r + 3);
    const len = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);

    if (ringAvailable(w, (r + 4) % RING_SIZE) < len) break;

    let cursor = (r + 4) % RING_SIZE;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = readByte(buf, TO_BUN_OFFSET, cursor);
      cursor = (cursor + 1) % RING_SIZE;
    }

    r = cursor;
    writeU32(buf, 4, r);

    const json = new TextDecoder().decode(bytes);
    try {
      messages.push(JSON.parse(json) as IpcMessage);
    } catch {
      // skip malformed
    }

    w = readU32(buf, 0);
  }

  return messages;
};

const writeToShim = (buf: Uint8Array, msg: IpcMessage): boolean => {
  const json = JSON.stringify(msg);
  const payload = new TextEncoder().encode(json);
  const needed = 4 + payload.length;

  const w = readU32(buf, 8);
  const r = readU32(buf, 12);

  if (ringFree(w, r) < needed) return false;

  let cursor = w;

  writeByte(buf, TO_SHIM_OFFSET, cursor, payload.length & 0xff);
  cursor = (cursor + 1) % RING_SIZE;
  writeByte(buf, TO_SHIM_OFFSET, cursor, (payload.length >> 8) & 0xff);
  cursor = (cursor + 1) % RING_SIZE;
  writeByte(buf, TO_SHIM_OFFSET, cursor, (payload.length >> 16) & 0xff);
  cursor = (cursor + 1) % RING_SIZE;
  writeByte(buf, TO_SHIM_OFFSET, cursor, (payload.length >> 24) & 0xff);
  cursor = (cursor + 1) % RING_SIZE;

  for (let i = 0; i < payload.length; i++) {
    writeByte(buf, TO_SHIM_OFFSET, cursor, payload[i]);
    cursor = (cursor + 1) % RING_SIZE;
  }

  writeU32(buf, 8, cursor);
  return true;
};

// Helper: simulate the shim writing into the TO_BUN ring (offsets 0/4 for w/r, data at TO_BUN_OFFSET)
const shimWriteToBun = (buf: Uint8Array, msg: IpcMessage): boolean => {
  const json = JSON.stringify(msg);
  const payload = new TextEncoder().encode(json);
  const needed = 4 + payload.length;

  const w = readU32(buf, 0);
  const r = readU32(buf, 4);

  if (ringFree(w, r) < needed) return false;

  let cursor = w;

  writeByte(buf, TO_BUN_OFFSET, cursor, payload.length & 0xff);
  cursor = (cursor + 1) % RING_SIZE;
  writeByte(buf, TO_BUN_OFFSET, cursor, (payload.length >> 8) & 0xff);
  cursor = (cursor + 1) % RING_SIZE;
  writeByte(buf, TO_BUN_OFFSET, cursor, (payload.length >> 16) & 0xff);
  cursor = (cursor + 1) % RING_SIZE;
  writeByte(buf, TO_BUN_OFFSET, cursor, (payload.length >> 24) & 0xff);
  cursor = (cursor + 1) % RING_SIZE;

  for (let i = 0; i < payload.length; i++) {
    writeByte(buf, TO_BUN_OFFSET, cursor, payload[i]);
    cursor = (cursor + 1) % RING_SIZE;
  }

  writeU32(buf, 0, cursor);
  return true;
};

const makeBuf = (): Uint8Array => {
  const buf = new Uint8Array(SHM_SIZE);
  buf.fill(0);
  return buf;
};

const makeMsg = (
  type: IpcMessage["type"],
  action: string,
  data?: unknown,
  id = "1",
): IpcMessage => ({ id, type, action, data });

describe("ring buffer", () => {
  test("writeToShim writes and data lands in the to-shim ring region", () => {
    const buf = makeBuf();
    const m = makeMsg("invoke", "test:ping", { v: 42 });
    const ok = writeToShim(buf, m);
    expect(ok).toBe(true);

    // write cursor (offset 8) should have advanced
    const w = readU32(buf, 8);
    expect(w).toBeGreaterThan(0);
  });

  test("shimWriteToBun then readFromShim round-trips a message", () => {
    const buf = makeBuf();
    const m = makeMsg("invoke", "test:echo", { msg: "hello" });
    const ok = shimWriteToBun(buf, m);
    expect(ok).toBe(true);

    const messages = readFromShim(buf);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(m);
  });

  test("multiple messages written then read", () => {
    const buf = makeBuf();
    const msgs = [
      makeMsg("invoke", "a:one", 1, "1"),
      makeMsg("event", "b:two", "hi", "2"),
      makeMsg("control", "c:three", undefined, "3"),
    ];

    for (const m of msgs) {
      expect(shimWriteToBun(buf, m)).toBe(true);
    }

    const read = readFromShim(buf);
    expect(read).toHaveLength(3);
    expect(read[0]).toEqual(msgs[0]);
    expect(read[1]).toEqual(msgs[1]);
    expect(read[2]).toEqual(msgs[2]);
  });

  test("ring buffer wrapping", () => {
    const buf = makeBuf();

    // Write messages until the write cursor wraps past RING_SIZE
    const payload = "x".repeat(500);
    let count = 0;
    const written: IpcMessage[] = [];

    // Fill, read, fill again to force wrapping
    for (let round = 0; round < 3; round++) {
      const batch: IpcMessage[] = [];
      for (let i = 0; i < 50; i++) {
        const m = makeMsg("invoke", "wrap:test", { i: count, payload }, String(count));
        if (!shimWriteToBun(buf, m)) break;
        batch.push(m);
        count++;
      }
      const read = readFromShim(buf);
      written.push(...batch);
      expect(read).toHaveLength(batch.length);
      for (let i = 0; i < read.length; i++) {
        expect(read[i]).toEqual(batch[i]);
      }
    }

    // Confirm we wrote enough to have wrapped
    expect(count).toBeGreaterThan(50);
  });

  test("buffer full condition returns false", () => {
    const buf = makeBuf();

    // Fill the to-bun ring completely with large messages
    const bigPayload = "y".repeat(10000);
    let writes = 0;
    while (shimWriteToBun(buf, makeMsg("invoke", "fill:test", bigPayload, String(writes)))) {
      writes++;
      if (writes > 10000) break; // safety
    }

    expect(writes).toBeGreaterThan(0);

    // The loop exited because shimWriteToBun returned false.
    // Verify that another write of the same size also fails.
    const overflow = shimWriteToBun(buf, makeMsg("invoke", "fill:test", bigPayload, "overflow"));
    expect(overflow).toBe(false);
  });

  test("empty buffer readFromShim returns empty array", () => {
    const buf = makeBuf();
    const messages = readFromShim(buf);
    expect(messages).toHaveLength(0);
  });

  test("readU32 and writeU32 are consistent", () => {
    const buf = makeBuf();
    writeU32(buf, 0, 12345);
    expect(readU32(buf, 0)).toBe(12345);

    writeU32(buf, 8, 0xffffffff);
    expect(readU32(buf, 8)).toBe(0xffffffff);

    writeU32(buf, 16, 0);
    expect(readU32(buf, 16)).toBe(0);
  });

  test("ringAvailable and ringFree are complementary", () => {
    // When w == r, available = 0, free = RING_SIZE - 1
    expect(ringAvailable(0, 0)).toBe(0);
    expect(ringFree(0, 0)).toBe(RING_SIZE - 1);

    // When w > r
    expect(ringAvailable(100, 10)).toBe(90);
    expect(ringFree(100, 10)).toBe(RING_SIZE - 91);

    // When w < r (wrapped)
    expect(ringAvailable(10, 100)).toBe(RING_SIZE - 90);
    expect(ringFree(10, 100)).toBe(89);
  });
});
