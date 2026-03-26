import { test, expect, describe } from "bun:test";
import type { IpcMessage } from "../src/types";

// Replicate isAllowed from src/cli/dev.ts (closure over allowlist)

const createIsAllowed = (allowlist: string[] | null) => {
  return (action: string): boolean => {
    if (!allowlist) return true;
    return allowlist.some((pattern) => {
      if (pattern === "*") return true;
      if (pattern.endsWith(":*")) {
        return action.startsWith(pattern.slice(0, -1));
      }
      return action === pattern;
    });
  };
};

// Replicate makeMsg from src/cli/dev.ts

let nextMsgId = 1;

const makeMsg = (type: IpcMessage["type"], action: string, data?: unknown): IpcMessage => ({
  id: String(nextMsgId++),
  type,
  action,
  data,
});

describe("isAllowed", () => {
  test("null allowlist permits everything", () => {
    const isAllowed = createIsAllowed(null);
    expect(isAllowed("anything:goes")).toBe(true);
    expect(isAllowed("")).toBe(true);
  });

  test("wildcard * permits everything", () => {
    const isAllowed = createIsAllowed(["*"]);
    expect(isAllowed("math:add")).toBe(true);
    expect(isAllowed("fs:read")).toBe(true);
  });

  test("exact match works", () => {
    const isAllowed = createIsAllowed(["math:add", "math:sub"]);
    expect(isAllowed("math:add")).toBe(true);
    expect(isAllowed("math:sub")).toBe(true);
    expect(isAllowed("math:mul")).toBe(false);
  });

  test("namespace wildcard pattern with :*", () => {
    const isAllowed = createIsAllowed(["math:*"]);
    expect(isAllowed("math:add")).toBe(true);
    expect(isAllowed("math:sub")).toBe(true);
    expect(isAllowed("math:anything")).toBe(true);
    expect(isAllowed("fs:read")).toBe(false);
  });

  test("mixed exact and namespace patterns", () => {
    const isAllowed = createIsAllowed(["math:*", "fs:read"]);
    expect(isAllowed("math:add")).toBe(true);
    expect(isAllowed("fs:read")).toBe(true);
    expect(isAllowed("fs:write")).toBe(false);
  });

  test("empty allowlist blocks everything", () => {
    const isAllowed = createIsAllowed([]);
    expect(isAllowed("math:add")).toBe(false);
    expect(isAllowed("")).toBe(false);
  });

  test("namespace wildcard does not match other namespaces", () => {
    const isAllowed = createIsAllowed(["dialog:*"]);
    expect(isAllowed("dialog:open")).toBe(true);
    expect(isAllowed("dialog:save")).toBe(true);
    expect(isAllowed("window:resize")).toBe(false);
    expect(isAllowed("dialogextra:open")).toBe(false);
  });

  test("action without colon tested against exact match", () => {
    const isAllowed = createIsAllowed(["nocoLon"]);
    expect(isAllowed("nocoLon")).toBe(true);
    expect(isAllowed("other")).toBe(false);
  });

  test("multiple namespace wildcards", () => {
    const isAllowed = createIsAllowed(["math:*", "dialog:*", "window:*"]);
    expect(isAllowed("math:add")).toBe(true);
    expect(isAllowed("dialog:open")).toBe(true);
    expect(isAllowed("window:close")).toBe(true);
    expect(isAllowed("fs:read")).toBe(false);
  });
});

describe("makeMsg", () => {
  // Reset counter for deterministic tests
  test("creates proper IpcMessage shape", () => {
    const before = nextMsgId;
    const m = makeMsg("invoke", "test:action", { key: "value" });

    expect(m.id).toBe(String(before));
    expect(m.type).toBe("invoke");
    expect(m.action).toBe("test:action");
    expect(m.data).toEqual({ key: "value" });
  });

  test("auto-increments id", () => {
    const m1 = makeMsg("invoke", "a:one");
    const m2 = makeMsg("event", "b:two");
    expect(Number(m2.id)).toBe(Number(m1.id) + 1);
  });

  test("data defaults to undefined when omitted", () => {
    const m = makeMsg("control", "reload");
    expect(m.data).toBeUndefined();
  });

  test("supports all message types", () => {
    const types: IpcMessage["type"][] = ["invoke", "response", "event", "control"];
    for (const t of types) {
      const m = makeMsg(t, "test:type");
      expect(m.type).toBe(t);
    }
  });

  test("data can be any serializable value", () => {
    expect(makeMsg("invoke", "a", 42).data).toBe(42);
    expect(makeMsg("invoke", "a", "str").data).toBe("str");
    expect(makeMsg("invoke", "a", [1, 2]).data).toEqual([1, 2]);
    expect(makeMsg("invoke", "a", null).data).toBeNull();
    expect(makeMsg("invoke", "a", true).data).toBe(true);
  });
});
