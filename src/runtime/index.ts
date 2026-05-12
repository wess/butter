import type { IpcMessage, WindowOptions } from "../types"

type Handler = (data: unknown) => unknown

export type CreateWindowOptions = {
  url: string
  title?: string
  width?: number
  height?: number
  x?: number
  y?: number
  frameless?: boolean
  transparent?: boolean
  alwaysOnTop?: boolean
  modal?: boolean
  // Translucent system material. See WindowOptions.material in types/index.ts
  // for the full per-platform behavior table.
  material?: "vibrancy" | "mica" | "acrylic" | "tabbed" | "none"
}

type Runtime = {
  on: (action: string, handler: Handler) => void
  tap: (action: string, fn: (data: unknown) => void) => void
  send: (action: string, data?: unknown) => void
  dispatch: (action: string, data: unknown) => unknown
  getWindow: () => WindowOptions
  setWindow: (opts: Partial<WindowOptions>) => void
  drainOutgoing: () => IpcMessage[]
  createWindow: (opts: CreateWindowOptions) => string
  sendChunk: (requestId: string, data: unknown) => void
  control: (action: string, data?: unknown) => Promise<unknown>
  tell: (action: string, data?: unknown) => void
  resolveControl: (id: string, data: unknown) => void
}

export const createRuntime = (
  initialWindow?: Partial<WindowOptions>,
): Runtime => {
  const handlers = new Map<string, Handler>()
  const taps = new Map<string, ((data: unknown) => void)[]>()
  const outgoing: IpcMessage[] = []
  // Per-runtime so multiple runtimes (or hot reloads) can't collide on ids.
  const pendingControls = new Map<string, (data: unknown) => void>()
  let nextId = 1
  let nextWindowId = 1

  let windowState: WindowOptions = {
    title: initialWindow?.title ?? "Butter App",
    width: initialWindow?.width ?? 800,
    height: initialWindow?.height ?? 600,
  }

  return {
    on: (action, handler) => {
      handlers.set(action, handler)
    },

    tap: (action, fn) => {
      taps.set(action, [...(taps.get(action) ?? []), fn])
    },

    send: (action, data) => {
      outgoing.push({
        id: String(nextId++),
        type: "event",
        action,
        data,
      })
    },

    dispatch: (action, data) => {
      for (const t of taps.get(action) ?? []) {
        try { t(data) } catch { /* taps must not break dispatch */ }
      }
      const handler = handlers.get(action)
      if (!handler) return undefined
      return handler(data)
    },

    getWindow: () => ({ ...windowState }),

    setWindow: (opts) => {
      windowState = { ...windowState, ...opts }
    },

    drainOutgoing: () => outgoing.splice(0),

    createWindow: (opts) => {
      const windowId = String(nextWindowId++)
      outgoing.push({
        id: String(nextId++),
        type: "control",
        action: "window:create",
        data: { windowId, ...opts },
      })
      return windowId
    },

    sendChunk: (requestId, data) => {
      outgoing.push({
        id: String(nextId++),
        type: "response",
        action: "chunk",
        data: { id: requestId, type: "chunk", data },
      })
    },

    control: (action, data) => {
      const id = String(nextId++)
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingControls.delete(id)
          reject(new Error(`Control "${action}" timed out after 30s`))
        }, 30_000)
        pendingControls.set(id, (result: unknown) => {
          clearTimeout(timer)
          resolve(result)
        })
        outgoing.push({ id, type: "control", action, data })
      })
    },

    // Fire-and-forget control message. Use when the shim performs the action
    // but has nothing meaningful to send back (e.g. dock badge, nav, window
    // state changes). No pendingControls entry, no 30s timer, no promise to
    // forget to await — so no unhandled rejection if the shim never acks.
    tell: (action, data) => {
      outgoing.push({
        id: String(nextId++),
        type: "control",
        action,
        data,
      })
    },

    resolveControl: (id, data) => {
      const resolve = pendingControls.get(id)
      if (resolve) {
        pendingControls.delete(id)
        resolve(data)
      }
    },
  }
}

// Default runtime instance — set by the CLI before importing host code
declare global {
  var __butterRuntime: Runtime | undefined
}

const getRuntime = (): Runtime => {
  if (!globalThis.__butterRuntime) throw new Error("Butter runtime not initialized")
  return globalThis.__butterRuntime
}

export const on = (action: string, handler: Handler) => getRuntime().on(action, handler)
export const tap = (action: string, fn: (data: unknown) => void) => getRuntime().tap(action, fn)
export const send = (action: string, data?: unknown) => getRuntime().send(action, data)
export const getWindow = () => getRuntime().getWindow()
// setWindow updates state synchronously and notifies the shim fire-and-forget.
// The shim has no response to send back, so we don't await.
export const setWindow = (opts: Partial<WindowOptions>) => {
  getRuntime().setWindow(opts)
  getRuntime().tell("window:set", opts)
}
export const createWindow = (opts: CreateWindowOptions) => getRuntime().createWindow(opts)
export const sendChunk = (requestId: string, data: unknown) => getRuntime().sendChunk(requestId, data)
// Fire-and-forget window/menu state changes — shim handlers don't ack.
export const maximize = () => getRuntime().tell("window:maximize")
export const minimize = () => getRuntime().tell("window:minimize")
export const restore = () => getRuntime().tell("window:restore")
export const fullscreen = (enable: boolean) => getRuntime().tell("window:fullscreen", { enable })
export const setAlwaysOnTop = (enable: boolean) => getRuntime().tell("window:alwaysontop", { enable })
export const closeWindow = (windowId?: string) => getRuntime().tell("window:close", { windowId })
export const setMenu = (menu: unknown) => getRuntime().tell("menu:set", menu)
export const print = () => getRuntime().tell("window:print")
export const ready = () => getRuntime().tell("window:ready")
// These DO get a meaningful response from the shim — keep as control().
export const screenshot = (path: string) => getRuntime().control("window:screenshot", { path })
export const listScreens = () => getRuntime().control("screen:list")
export const idleSeconds = () => getRuntime().control("power:idle")
