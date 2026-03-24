import { test, expect } from "bun:test"
import { createRuntime } from "../src/runtime"

test("on registers handler and dispatch calls it", () => {
  const rt = createRuntime()
  let called = false
  rt.on("test:action", (data) => {
    called = true
    return `got ${data}`
  })
  const result = rt.dispatch("test:action", "hello")
  expect(called).toBe(true)
  expect(result).toBe("got hello")
})

test("dispatch returns undefined for unregistered action", () => {
  const rt = createRuntime()
  const result = rt.dispatch("nonexistent", null)
  expect(result).toBeUndefined()
})

test("send queues outgoing message", () => {
  const rt = createRuntime()
  rt.send("status:updated", { ready: true })
  const queued = rt.drainOutgoing()
  expect(queued).toHaveLength(1)
  expect(queued[0].action).toBe("status:updated")
  expect(queued[0].data).toEqual({ ready: true })
})

test("getWindow returns current window state", () => {
  const rt = createRuntime()
  const win = rt.getWindow()
  expect(win.title).toBe("Butter App")
  expect(win.width).toBe(800)
  expect(win.height).toBe(600)
})

test("setWindow updates window state", () => {
  const rt = createRuntime()
  rt.setWindow({ title: "New Title" })
  expect(rt.getWindow().title).toBe("New Title")
  expect(rt.getWindow().width).toBe(800)
})
