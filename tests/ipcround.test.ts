import { test, expect, describe } from "bun:test";
import { encode, decode, decodeAll } from "../src/ipc/protocol";
import type { IpcMessage } from "../src/types";

const msg = (
  type: IpcMessage["type"],
  action: string,
  data?: unknown,
  id = "1",
): IpcMessage => ({ id, type, action, data });

describe("IPC round-trip", () => {
  test("invoke message round-trips correctly", () => {
    const m = msg("invoke", "math:add", { a: 1, b: 2 });
    const buf = encode(m);
    const { message, bytesRead } = decode(buf, 0);
    expect(message).toEqual(m);
    expect(bytesRead).toBe(buf.length);
  });

  test("response message round-trips correctly", () => {
    const m = msg("response", "math:add", { result: 3 });
    const buf = encode(m);
    const { message } = decode(buf, 0);
    expect(message).toEqual(m);
  });

  test("event message round-trips correctly", () => {
    const m = msg("event", "user:clicked", { target: "button" });
    const buf = encode(m);
    const { message } = decode(buf, 0);
    expect(message).toEqual(m);
  });

  test("control message round-trips correctly", () => {
    const m = msg("control", "quit");
    const buf = encode(m);
    const { message } = decode(buf, 0);
    expect(message).toEqual(m);
  });

  test("decodeAll with multiple concatenated messages", () => {
    const m1 = msg("invoke", "a:one", 1, "1");
    const m2 = msg("event", "b:two", "hello", "2");
    const m3 = msg("control", "reload", undefined, "3");

    const b1 = encode(m1);
    const b2 = encode(m2);
    const b3 = encode(m3);

    const combined = new Uint8Array(b1.length + b2.length + b3.length);
    combined.set(b1, 0);
    combined.set(b2, b1.length);
    combined.set(b3, b1.length + b2.length);

    const messages = decodeAll(combined);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual(m1);
    expect(messages[1]).toEqual(m2);
    expect(messages[2]).toEqual(m3);
  });

  test("decode with truncated buffer returns null", () => {
    const m = msg("invoke", "test:action", { foo: "bar" });
    const buf = encode(m);
    // chop off last 5 bytes so payload is incomplete
    const truncated = buf.slice(0, buf.length - 5);
    const { message, bytesRead } = decode(truncated, 0);
    expect(message).toBeNull();
    expect(bytesRead).toBe(0);
  });

  test("decode with empty buffer returns null", () => {
    const empty = new Uint8Array(0);
    const { message, bytesRead } = decode(empty, 0);
    expect(message).toBeNull();
    expect(bytesRead).toBe(0);
  });

  test("decode with buffer smaller than header returns null", () => {
    const tiny = new Uint8Array(3);
    const { message, bytesRead } = decode(tiny, 0);
    expect(message).toBeNull();
    expect(bytesRead).toBe(0);
  });

  test("messages with unicode data", () => {
    const m = msg("invoke", "i18n:greet", { text: "こんにちは世界 🌍 Ñoño" });
    const buf = encode(m);
    const { message } = decode(buf, 0);
    expect(message).toEqual(m);
    expect(message!.data).toEqual({ text: "こんにちは世界 🌍 Ñoño" });
  });

  test("messages with large payloads", () => {
    const bigData = "x".repeat(100_000);
    const m = msg("invoke", "upload:data", { payload: bigData });
    const buf = encode(m);
    const { message } = decode(buf, 0);
    expect(message).toEqual(m);
    expect((message!.data as { payload: string }).payload.length).toBe(100_000);
  });

  test("messages with special characters in action names", () => {
    const m = msg("invoke", "ns:action/sub.path#ref");
    const buf = encode(m);
    const { message } = decode(buf, 0);
    expect(message!.action).toBe("ns:action/sub.path#ref");
  });

  test("messages with nested objects in data", () => {
    const nested = {
      level1: {
        level2: {
          level3: { values: [1, 2, 3], flag: true },
        },
        tags: ["a", "b"],
      },
    };
    const m = msg("invoke", "deep:data", nested);
    const buf = encode(m);
    const { message } = decode(buf, 0);
    expect(message!.data).toEqual(nested);
  });

  test("messages with null data field", () => {
    const m = msg("invoke", "test:null", null);
    const buf = encode(m);
    const { message } = decode(buf, 0);
    expect(message!.data).toBeNull();
  });

  test("messages with undefined data field", () => {
    const m = msg("invoke", "test:undef", undefined);
    const buf = encode(m);
    const { message } = decode(buf, 0);
    // undefined is omitted by JSON.stringify
    expect(message!.data).toBeUndefined();
  });

  test("decodeAll stops at truncated trailing message", () => {
    const m1 = msg("invoke", "a:ok", 1, "1");
    const m2 = msg("invoke", "b:ok", 2, "2");
    const b1 = encode(m1);
    const b2 = encode(m2);

    // combine fully + partial
    const combined = new Uint8Array(b1.length + b2.length - 3);
    combined.set(b1, 0);
    combined.set(b2.slice(0, b2.length - 3), b1.length);

    const messages = decodeAll(combined);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(m1);
  });
});
