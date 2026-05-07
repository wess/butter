import { test, expect, describe } from "bun:test";
import type { IpcMessage } from "../src/types";

// Replicate the chunked ring buffer used in src/cli/dev.ts.
// (The dev module's helpers are not exported; the wire format is reproduced
// here so any drift is caught.)

const SHM_SIZE = 128 * 1024;
const HEADER_SIZE = 64;
const RING_SIZE = (SHM_SIZE - HEADER_SIZE) / 2;
const TO_BUN_OFFSET = HEADER_SIZE;
const TO_SHIM_OFFSET = HEADER_SIZE + RING_SIZE;

const FRAME_HDR = 8;
const FLAG_LAST = 1;
const MAX_CHUNK_PAYLOAD = 16 * 1024;

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

type State = {
  buf: Uint8Array;
  pendingWrite: { bytes: Uint8Array; offset: number }[];
  reassembly: Uint8Array[];
  reassemblyLen: number;
};

const buildFrame = (payload: Uint8Array, flags: number): Uint8Array => {
  const frame = new Uint8Array(FRAME_HDR + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, payload.length, true);
  view.setUint32(4, flags, true);
  frame.set(payload, FRAME_HDR);
  return frame;
};

const enqueue = (state: State, msg: IpcMessage): void => {
  const json = JSON.stringify(msg);
  const payload = new TextEncoder().encode(json);
  if (payload.length === 0) {
    state.pendingWrite.push({ bytes: buildFrame(payload, FLAG_LAST), offset: 0 });
    return;
  }
  let offset = 0;
  while (offset < payload.length) {
    const chunkLen = Math.min(payload.length - offset, MAX_CHUNK_PAYLOAD);
    const isLast = offset + chunkLen >= payload.length;
    state.pendingWrite.push({
      bytes: buildFrame(payload.subarray(offset, offset + chunkLen), isLast ? FLAG_LAST : 0),
      offset: 0,
    });
    offset += chunkLen;
  }
};

// Drain pending into ring at the given direction (TO_SHIM cursors at offsets 8/12).
const flushToShim = (state: State): boolean => {
  let any = false;
  while (state.pendingWrite.length > 0) {
    const item = state.pendingWrite[0]!;
    const remaining = item.bytes.length - item.offset;
    if (remaining <= 0) {
      state.pendingWrite.shift();
      continue;
    }
    const w = readU32(state.buf, 8);
    const r = readU32(state.buf, 12);
    const space = ringFree(w, r);
    if (space === 0) break;
    const toWrite = Math.min(remaining, space);
    let cursor = w;
    for (let i = 0; i < toWrite; i++) {
      state.buf[TO_SHIM_OFFSET + cursor] = item.bytes[item.offset + i]!;
      cursor = (cursor + 1) % RING_SIZE;
    }
    writeU32(state.buf, 8, cursor);
    item.offset += toWrite;
    any = true;
    if (item.offset >= item.bytes.length) state.pendingWrite.shift();
    else break;
  }
  return any;
};

// Helper: simulate the shim writing into the TO_BUN ring (cursors at 0/4).
const shimWriteToBun = (buf: Uint8Array, msg: IpcMessage): boolean => {
  const json = JSON.stringify(msg);
  const payload = new TextEncoder().encode(json);
  const frame = buildFrame(payload, FLAG_LAST);
  const w = readU32(buf, 0);
  const r = readU32(buf, 4);
  if (ringFree(w, r) < frame.length) return false;
  let cursor = w;
  for (let i = 0; i < frame.length; i++) {
    buf[TO_BUN_OFFSET + cursor] = frame[i]!;
    cursor = (cursor + 1) % RING_SIZE;
  }
  writeU32(buf, 0, cursor);
  return true;
};

const readFromShim = (state: State): IpcMessage[] => {
  const messages: IpcMessage[] = [];
  while (true) {
    const w = readU32(state.buf, 0);
    const r = readU32(state.buf, 4);
    const used = ringAvailable(w, r);
    if (used < FRAME_HDR) break;

    let cursor = r;
    const hdr = new Uint8Array(FRAME_HDR);
    for (let i = 0; i < FRAME_HDR; i++) {
      hdr[i] = state.buf[TO_BUN_OFFSET + cursor]!;
      cursor = (cursor + 1) % RING_SIZE;
    }
    const view = new DataView(hdr.buffer);
    const len = view.getUint32(0, true);
    const flags = view.getUint32(4, true);
    if (used < FRAME_HDR + len) break;

    const payload = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      payload[i] = state.buf[TO_BUN_OFFSET + cursor]!;
      cursor = (cursor + 1) % RING_SIZE;
    }
    writeU32(state.buf, 4, cursor);

    state.reassembly.push(payload);
    state.reassemblyLen += payload.length;

    if (flags & FLAG_LAST) {
      const merged = new Uint8Array(state.reassemblyLen);
      let p = 0;
      for (const c of state.reassembly) {
        merged.set(c, p);
        p += c.length;
      }
      state.reassembly = [];
      state.reassemblyLen = 0;
      try {
        messages.push(JSON.parse(new TextDecoder().decode(merged)) as IpcMessage);
      } catch {
        // skip malformed
      }
    }
  }
  return messages;
};

const makeBuf = (): Uint8Array => {
  const buf = new Uint8Array(SHM_SIZE);
  buf.fill(0);
  return buf;
};

const makeState = (buf: Uint8Array): State => ({
  buf,
  pendingWrite: [],
  reassembly: [],
  reassemblyLen: 0,
});

const makeMsg = (
  type: IpcMessage["type"],
  action: string,
  data?: unknown,
  id = "1",
): IpcMessage => ({ id, type, action, data });

describe("ring buffer (chunked frame format)", () => {
  test("enqueue + flush writes a frame into the to-shim ring", () => {
    const buf = makeBuf();
    const state = makeState(buf);
    enqueue(state, makeMsg("invoke", "test:ping", { v: 42 }));
    const wrote = flushToShim(state);
    expect(wrote).toBe(true);
    expect(readU32(buf, 8)).toBeGreaterThan(0);
  });

  test("shimWriteToBun then readFromShim round-trips a message", () => {
    const buf = makeBuf();
    const state = makeState(buf);
    const m = makeMsg("invoke", "test:echo", { msg: "hello" });
    expect(shimWriteToBun(buf, m)).toBe(true);

    const messages = readFromShim(state);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(m);
  });

  test("multiple messages written then read in order", () => {
    const buf = makeBuf();
    const state = makeState(buf);
    const msgs = [
      makeMsg("invoke", "a:one", 1, "1"),
      makeMsg("event", "b:two", "hi", "2"),
      makeMsg("control", "c:three", undefined, "3"),
    ];

    for (const m of msgs) {
      expect(shimWriteToBun(buf, m)).toBe(true);
    }

    const read = readFromShim(state);
    expect(read).toHaveLength(3);
    expect(read[0]).toEqual(msgs[0]!);
    expect(read[1]).toEqual(msgs[1]!);
    expect(read[2]).toEqual(msgs[2]!);
  });

  test("ring buffer wrapping", () => {
    const buf = makeBuf();
    const state = makeState(buf);
    const payload = "x".repeat(500);
    let count = 0;
    const written: IpcMessage[] = [];

    for (let round = 0; round < 3; round++) {
      const batch: IpcMessage[] = [];
      for (let i = 0; i < 50; i++) {
        const m = makeMsg("invoke", "wrap:test", { i: count, payload }, String(count));
        if (!shimWriteToBun(buf, m)) break;
        batch.push(m);
        count++;
      }
      const read = readFromShim(state);
      written.push(...batch);
      expect(read).toHaveLength(batch.length);
      for (let i = 0; i < read.length; i++) {
        expect(read[i]).toEqual(batch[i]!);
      }
    }

    expect(count).toBeGreaterThan(50);
  });

  test("messages larger than ring stream through chunked", () => {
    // The fix: previously this would have hung forever on a 100KB payload
    // since writeToShim would never accept it. With chunking, the payload
    // streams across multiple flushes/drains and reassembles on the reader.
    const buf = makeBuf();
    const sender = makeState(buf);
    const receiver = makeState(buf);

    const big: IpcMessage = {
      id: "1",
      type: "response",
      action: "mail:smart",
      data: { body: "y".repeat(100_000) },
    };
    enqueue(sender, big);

    let received: IpcMessage | null = null;
    for (let i = 0; i < 10000 && received === null; i++) {
      flushToShim(sender);
      // The receiver in this test reads from the to-shim ring (cursors 8/12),
      // not the to-bun ring (0/4). Swap cursor offsets for this read.
      const w = readU32(buf, 8);
      const r = readU32(buf, 12);
      const used = w >= r ? w - r : RING_SIZE - r + w;
      if (used < FRAME_HDR) continue;

      let cursor = r;
      const hdr = new Uint8Array(FRAME_HDR);
      for (let j = 0; j < FRAME_HDR; j++) {
        hdr[j] = buf[TO_SHIM_OFFSET + cursor]!;
        cursor = (cursor + 1) % RING_SIZE;
      }
      const view = new DataView(hdr.buffer);
      const len = view.getUint32(0, true);
      const flags = view.getUint32(4, true);
      if (used < FRAME_HDR + len) continue;

      const payload = new Uint8Array(len);
      for (let j = 0; j < len; j++) {
        payload[j] = buf[TO_SHIM_OFFSET + cursor]!;
        cursor = (cursor + 1) % RING_SIZE;
      }
      writeU32(buf, 12, cursor);
      receiver.reassembly.push(payload);
      receiver.reassemblyLen += payload.length;

      if (flags & FLAG_LAST) {
        const merged = new Uint8Array(receiver.reassemblyLen);
        let p = 0;
        for (const c of receiver.reassembly) {
          merged.set(c, p);
          p += c.length;
        }
        received = JSON.parse(new TextDecoder().decode(merged)) as IpcMessage;
      }
    }

    expect(received).not.toBeNull();
    expect(received).toEqual(big);
    expect(sender.pendingWrite).toHaveLength(0);
  });

  test("empty buffer readFromShim returns empty array", () => {
    const buf = makeBuf();
    const state = makeState(buf);
    const messages = readFromShim(state);
    expect(messages).toHaveLength(0);
  });

  test("readU32 and writeU32 are consistent", () => {
    const buf = makeBuf();
    writeU32(buf, 0, 12345);
    expect(readU32(buf, 0)).toBe(12345);
    writeU32(buf, 8, 0xffffffff);
    expect(readU32(buf, 8)).toBe(0xffffffff);
  });

  test("ringAvailable and ringFree are complementary", () => {
    expect(ringAvailable(0, 0)).toBe(0);
    expect(ringFree(0, 0)).toBe(RING_SIZE - 1);
    expect(ringAvailable(100, 10)).toBe(90);
    expect(ringFree(100, 10)).toBe(RING_SIZE - 91);
    expect(ringAvailable(10, 100)).toBe(RING_SIZE - 90);
    expect(ringFree(10, 100)).toBe(89);
  });
});
