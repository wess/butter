export type InvokeMap = Record<string, { input: unknown; output: unknown }>

export type WindowOptions = {
  title: string
  width: number
  height: number
  icon?: string
  x?: number
  y?: number
  minWidth?: number
  minHeight?: number
  resizable?: boolean
  frameless?: boolean
  transparent?: boolean
  alwaysOnTop?: boolean
  fullscreen?: boolean
}

export type BuildOptions = {
  entry: string
  host: string
}

export type BundleOptions = {
  identifier?: string
  category?: string
  urlSchemes?: string[]
}

export type SecurityOptions = {
  csp?: string
  allowlist?: string[]
}

export type MCPOptions = {
  enabled?: boolean
  port?: number
  consoleBuffer?: number
}

export type DevOptions = {
  mcp?: MCPOptions
}

export type Config = {
  window: WindowOptions
  build: BuildOptions
  bundle?: BundleOptions
  plugins?: string[]
  security?: SecurityOptions
  dev?: DevOptions
  splash?: string
}

export type MenuItem =
  | { label: string; action: string; shortcut?: string }
  | { separator: true }

export type MenuSection = {
  label: string
  items: MenuItem[]
}

export type Menu = MenuSection[]

export type HostContext = {
  on: (action: string, handler: (data: unknown) => unknown) => void
  send: (action: string, data: unknown) => void
}

export type Plugin = {
  name: string
  host: (ctx: HostContext) => void
  webview: () => string
}

export type IpcMessage = {
  id: string
  type: "invoke" | "response" | "event" | "control"
  action: string
  data?: unknown
  error?: string
}

export { createTypedInvoke } from "./invoke"
export { createTypedHandlers } from "./handler"
