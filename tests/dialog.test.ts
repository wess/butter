import { test, expect, describe } from "bun:test"

/**
 * Tests for src/dialog/index.ts
 *
 * The dialog module detects host vs webview context and calls the
 * appropriate invoke path. We mock globalThis to simulate both contexts.
 */

// ── normalizeBool (replicated from source) ──────────────────────────────────

const normalizeBool = (v: unknown): boolean => v === true || v === "true"

describe("normalizeBool", () => {
  test("returns true for boolean true", () => {
    expect(normalizeBool(true)).toBe(true)
  })

  test("returns true for string 'true'", () => {
    expect(normalizeBool("true")).toBe(true)
  })

  test("returns false for boolean false", () => {
    expect(normalizeBool(false)).toBe(false)
  })

  test("returns false for string 'false'", () => {
    expect(normalizeBool("false")).toBe(false)
  })

  test("returns false for null", () => {
    expect(normalizeBool(null)).toBe(false)
  })

  test("returns false for undefined", () => {
    expect(normalizeBool(undefined)).toBe(false)
  })

  test("returns false for number 1", () => {
    expect(normalizeBool(1)).toBe(false)
  })

  test("returns false for empty string", () => {
    expect(normalizeBool("")).toBe(false)
  })

  test("returns false for string 'TRUE' (case-sensitive)", () => {
    expect(normalizeBool("TRUE")).toBe(false)
  })
})

// ── Context detection (replicated from source) ─────────────────────────────

const isWebview = (): boolean =>
  typeof globalThis.__butterRuntime === "undefined" &&
  typeof (globalThis as any).butter?.invoke === "function"

const isHost = (): boolean =>
  typeof globalThis.__butterRuntime !== "undefined"

describe("context detection", () => {
  test("isWebview returns false when no butter object", () => {
    const prev = (globalThis as any).butter
    const prevRt = (globalThis as any).__butterRuntime
    delete (globalThis as any).butter
    delete (globalThis as any).__butterRuntime
    expect(isWebview()).toBe(false)
    if (prev !== undefined) (globalThis as any).butter = prev
    if (prevRt !== undefined) (globalThis as any).__butterRuntime = prevRt
  })

  test("isWebview returns true when butter.invoke exists and no runtime", () => {
    const prev = (globalThis as any).butter
    const prevRt = (globalThis as any).__butterRuntime
    delete (globalThis as any).__butterRuntime
    ;(globalThis as any).butter = { invoke: () => {} }
    expect(isWebview()).toBe(true)
    if (prev !== undefined) (globalThis as any).butter = prev
    else delete (globalThis as any).butter
    if (prevRt !== undefined) (globalThis as any).__butterRuntime = prevRt
  })

  test("isWebview returns false when __butterRuntime exists", () => {
    const prev = (globalThis as any).__butterRuntime
    ;(globalThis as any).__butterRuntime = {}
    expect(isWebview()).toBe(false)
    if (prev !== undefined) (globalThis as any).__butterRuntime = prev
    else delete (globalThis as any).__butterRuntime
  })

  test("isHost returns true when __butterRuntime exists", () => {
    const prev = (globalThis as any).__butterRuntime
    ;(globalThis as any).__butterRuntime = {}
    expect(isHost()).toBe(true)
    if (prev !== undefined) (globalThis as any).__butterRuntime = prev
    else delete (globalThis as any).__butterRuntime
  })

  test("isHost returns false when __butterRuntime is absent", () => {
    const prev = (globalThis as any).__butterRuntime
    delete (globalThis as any).__butterRuntime
    expect(isHost()).toBe(false)
    if (prev !== undefined) (globalThis as any).__butterRuntime = prev
  })
})

// ── dialog API via webview mock ─────────────────────────────────────────────

describe("dialog invoke calls (webview context)", () => {
  const setupWebviewMock = () => {
    const calls: { action: string; data: unknown }[] = []
    const prevButter = (globalThis as any).butter
    const prevRt = (globalThis as any).__butterRuntime
    delete (globalThis as any).__butterRuntime
    ;(globalThis as any).butter = {
      invoke: (action: string, data: unknown) => {
        calls.push({ action, data })
        // Return mock responses depending on action
        if (action === "dialog:open")
          return Promise.resolve({ paths: ["/tmp/file.txt"], cancelled: false })
        if (action === "dialog:save")
          return Promise.resolve({ path: "/tmp/save.txt", cancelled: false })
        if (action === "dialog:folder")
          return Promise.resolve({ paths: ["/tmp/folder"], cancelled: false })
        if (action === "dialog:message")
          return Promise.resolve({ button: 1, cancelled: false })
        return Promise.resolve({})
      },
    }
    return {
      calls,
      cleanup: () => {
        if (prevButter !== undefined) (globalThis as any).butter = prevButter
        else delete (globalThis as any).butter
        if (prevRt !== undefined) (globalThis as any).__butterRuntime = prevRt
      },
    }
  }

  test("dialog.open calls invoke with dialog:open action", async () => {
    const { calls, cleanup } = setupWebviewMock()
    try {
      const { dialog } = await import("../src/dialog")
      const result = await dialog.open({ title: "Pick", multiple: true })
      const call = calls.find((c) => c.action === "dialog:open")
      expect(call).toBeDefined()
      expect((call!.data as any).title).toBe("Pick")
      expect((call!.data as any).multiple).toBe(true)
      expect(result.paths).toEqual(["/tmp/file.txt"])
      expect(result.cancelled).toBe(false)
    } finally {
      cleanup()
    }
  })

  test("dialog.open normalizes missing paths to empty array", async () => {
    const prevButter = (globalThis as any).butter
    const prevRt = (globalThis as any).__butterRuntime
    delete (globalThis as any).__butterRuntime
    ;(globalThis as any).butter = {
      invoke: () => Promise.resolve({ paths: null, cancelled: false }),
    }
    try {
      const { dialog } = await import("../src/dialog")
      const result = await dialog.open()
      expect(result.paths).toEqual([])
      expect(result.cancelled).toBe(true) // no paths means cancelled
    } finally {
      if (prevButter !== undefined) (globalThis as any).butter = prevButter
      else delete (globalThis as any).butter
      if (prevRt !== undefined) (globalThis as any).__butterRuntime = prevRt
    }
  })

  test("dialog.save calls invoke with dialog:save action", async () => {
    const { calls, cleanup } = setupWebviewMock()
    try {
      const { dialog } = await import("../src/dialog")
      const result = await dialog.save({ defaultName: "data.csv" })
      const call = calls.find((c) => c.action === "dialog:save")
      expect(call).toBeDefined()
      expect((call!.data as any).defaultName).toBe("data.csv")
      expect(result.path).toBe("/tmp/save.txt")
      expect(result.cancelled).toBe(false)
    } finally {
      cleanup()
    }
  })

  test("dialog.save normalizes empty path to cancelled", async () => {
    const prevButter = (globalThis as any).butter
    const prevRt = (globalThis as any).__butterRuntime
    delete (globalThis as any).__butterRuntime
    ;(globalThis as any).butter = {
      invoke: () => Promise.resolve({ path: "", cancelled: false }),
    }
    try {
      const { dialog } = await import("../src/dialog")
      const result = await dialog.save()
      expect(result.path).toBe("")
      expect(result.cancelled).toBe(true)
    } finally {
      if (prevButter !== undefined) (globalThis as any).butter = prevButter
      else delete (globalThis as any).butter
      if (prevRt !== undefined) (globalThis as any).__butterRuntime = prevRt
    }
  })

  test("dialog.folder calls invoke with dialog:folder action", async () => {
    const { calls, cleanup } = setupWebviewMock()
    try {
      const { dialog } = await import("../src/dialog")
      const result = await dialog.folder({ prompt: "Choose dir" })
      const call = calls.find((c) => c.action === "dialog:folder")
      expect(call).toBeDefined()
      expect((call!.data as any).prompt).toBe("Choose dir")
      expect(result.paths).toEqual(["/tmp/folder"])
    } finally {
      cleanup()
    }
  })

  test("dialog.message calls invoke with dialog:message action", async () => {
    const { calls, cleanup } = setupWebviewMock()
    try {
      const { dialog } = await import("../src/dialog")
      const result = await dialog.message({
        message: "Are you sure?",
        type: "warning",
        buttons: ["Cancel", "OK"],
      })
      const call = calls.find((c) => c.action === "dialog:message")
      expect(call).toBeDefined()
      expect((call!.data as any).message).toBe("Are you sure?")
      expect(result.button).toBe(1)
      expect(result.cancelled).toBe(false)
    } finally {
      cleanup()
    }
  })

  test("dialog.alert calls invoke with info type and OK button", async () => {
    const { calls, cleanup } = setupWebviewMock()
    try {
      const { dialog } = await import("../src/dialog")
      await dialog.alert("Something happened")
      const call = calls.find((c) => c.action === "dialog:message")
      expect(call).toBeDefined()
      const data = call!.data as any
      expect(data.message).toBe("Something happened")
      expect(data.title).toBe("Alert")
      expect(data.type).toBe("info")
      expect(data.buttons).toEqual(["OK"])
    } finally {
      cleanup()
    }
  })

  test("dialog.alert accepts custom title", async () => {
    const { calls, cleanup } = setupWebviewMock()
    try {
      const { dialog } = await import("../src/dialog")
      await dialog.alert("Hello", "Custom Title")
      const call = calls.find((c) => c.action === "dialog:message")
      expect((call!.data as any).title).toBe("Custom Title")
    } finally {
      cleanup()
    }
  })

  test("dialog.confirm calls invoke with Cancel and OK buttons", async () => {
    const { calls, cleanup } = setupWebviewMock()
    try {
      const { dialog } = await import("../src/dialog")
      const result = await dialog.confirm("Delete this?")
      const call = calls.find((c) => c.action === "dialog:message")
      expect(call).toBeDefined()
      const data = call!.data as any
      expect(data.buttons).toEqual(["Cancel", "OK"])
      expect(data.title).toBe("Confirm")
      expect(result).toBe(true) // button === 1
    } finally {
      cleanup()
    }
  })

  test("dialog.confirm returns false when button is not 1", async () => {
    const prevButter = (globalThis as any).butter
    const prevRt = (globalThis as any).__butterRuntime
    delete (globalThis as any).__butterRuntime
    ;(globalThis as any).butter = {
      invoke: () => Promise.resolve({ button: 0, cancelled: false }),
    }
    try {
      const { dialog } = await import("../src/dialog")
      const result = await dialog.confirm("Delete?")
      expect(result).toBe(false)
    } finally {
      if (prevButter !== undefined) (globalThis as any).butter = prevButter
      else delete (globalThis as any).butter
      if (prevRt !== undefined) (globalThis as any).__butterRuntime = prevRt
    }
  })
})

// ── Error when no context ───────────────────────────────────────────────────

describe("dialog with no context", () => {
  test("throws when not in host or webview context", async () => {
    const prevButter = (globalThis as any).butter
    const prevRt = (globalThis as any).__butterRuntime
    delete (globalThis as any).__butterRuntime
    delete (globalThis as any).butter
    try {
      const { dialog } = await import("../src/dialog")
      expect(dialog.open()).rejects.toThrow("not running in a Butter context")
    } finally {
      if (prevButter !== undefined) (globalThis as any).butter = prevButter
      if (prevRt !== undefined) (globalThis as any).__butterRuntime = prevRt
    }
  })
})
