import type { IpcMessage, WindowOptions } from "../types"

type Handler = (data: unknown) => unknown

export type CreateWindowOptions = {
  url: string
  title?: string
  width?: number
  height?: number
}

type Runtime = {
  on: (action: string, handler: Handler) => void
  send: (action: string, data?: unknown) => void
  dispatch: (action: string, data: unknown) => unknown
  getWindow: () => WindowOptions
  setWindow: (opts: Partial<WindowOptions>) => void
  drainOutgoing: () => IpcMessage[]
  createWindow: (opts: CreateWindowOptions) => string
  sendChunk: (requestId: string, data: unknown) => void
}

export const createRuntime = (
  initialWindow?: Partial<WindowOptions>,
): Runtime => {
  const handlers = new Map<string, Handler>()
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

    send: (action, data) => {
      outgoing.push({
        id: String(nextId++),
        type: "event",
        action,
        data,
      })
    },

    dispatch: (action, data) => {
      const handler = handlers.get(action)
      if (!handler) return undefined
      return handler(data)
    },

    getWindow: () => ({ ...windowState }),

    setWindow: (opts) => {
      windowState = { ...windowState, ...opts }
    },

    drainOutgoing: () => outgoing.splice(0),

    // Queues a window:create control message to the shim.
    // TODO(darwin.m): shim-side window:create support must be implemented to
    // actually open a new NSWindow + WKWebView for each unique window ID.
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
export const send = (action: string, data?: unknown) => getRuntime().send(action, data)
export const getWindow = () => getRuntime().getWindow()
export const setWindow = (opts: Partial<WindowOptions>) => getRuntime().setWindow(opts)
export const createWindow = (opts: CreateWindowOptions) => getRuntime().createWindow(opts)
export const sendChunk = (requestId: string, data: unknown) => getRuntime().sendChunk(requestId, data)
