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
  resolveControl: (id: string, data: unknown) => void
}

export const createRuntime = (
  initialWindow?: Partial<WindowOptions>,
): Runtime => {
  const handlers = new Map<string, Handler>()
  const taps = new Map<string, ((data: unknown) => void)[]>()
  const outgoing: IpcMessage[] = []
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
      for (const t of taps.get(action) ?? []) t(data)
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
      if (!globalThis.__butterPendingControls) {
        globalThis.__butterPendingControls = new Map()
      }
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          globalThis.__butterPendingControls?.delete(id)
          reject(new Error(`Control "${action}" timed out after 30s`))
        }, 30_000)
        globalThis.__butterPendingControls.set(id, (result: unknown) => {
          clearTimeout(timer)
          resolve(result)
        })
        outgoing.push({ id, type: "control", action, data })
      })
    },

    resolveControl: (id, data) => {
      const resolve = globalThis.__butterPendingControls?.get(id)
      if (resolve) {
        globalThis.__butterPendingControls.delete(id)
        resolve(data)
      }
    },
  }
}

// Default runtime instance — set by the CLI before importing host code
declare global {
  var __butterRuntime: Runtime | undefined
  var __butterPendingControls: Map<string, (data: unknown) => void> | undefined
}

const getRuntime = (): Runtime => {
  if (!globalThis.__butterRuntime) throw new Error("Butter runtime not initialized")
  return globalThis.__butterRuntime
}

export const on = (action: string, handler: Handler) => getRuntime().on(action, handler)
export const tap = (action: string, fn: (data: unknown) => void) => getRuntime().tap(action, fn)
export const send = (action: string, data?: unknown) => getRuntime().send(action, data)
export const getWindow = () => getRuntime().getWindow()
export const setWindow = (opts: Partial<WindowOptions>) => {
  getRuntime().setWindow(opts)
  return getRuntime().control("window:set", opts)
}
export const createWindow = (opts: CreateWindowOptions) => getRuntime().createWindow(opts)
export const sendChunk = (requestId: string, data: unknown) => getRuntime().sendChunk(requestId, data)
export const maximize = () => getRuntime().control("window:maximize")
export const minimize = () => getRuntime().control("window:minimize")
export const restore = () => getRuntime().control("window:restore")
export const fullscreen = (enable: boolean) => getRuntime().control("window:fullscreen", { enable })
export const setAlwaysOnTop = (enable: boolean) => getRuntime().control("window:alwaysontop", { enable })
export const closeWindow = (windowId?: string) => getRuntime().control("window:close", { windowId })
export const setMenu = (menu: unknown) => getRuntime().control("menu:set", menu)
export const print = () => getRuntime().control("window:print")
export const screenshot = (path: string) => getRuntime().control("window:screenshot", { path })
export const ready = () => getRuntime().control("window:ready")
export const listScreens = () => getRuntime().control("screen:list")
