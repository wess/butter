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

/**
 * Privacy usage descriptions written into the macOS Info.plist when bundling.
 * Required for any app that calls protected APIs (microphone, camera, location,
 * AppleScript automation, etc.) — without these, macOS silently denies access.
 *
 * Each key here maps to its NS*UsageDescription Info.plist key.
 */
export type UsageDescriptions = {
  microphone?: string
  camera?: string
  appleEvents?: string
  calendar?: string
  contacts?: string
  reminders?: string
  photos?: string
  location?: string
  bluetooth?: string
  screenCapture?: string
}

export type BundleOptions = {
  identifier?: string
  category?: string
  urlSchemes?: string[]
  usageDescriptions?: UsageDescriptions
  minimumSystemVersion?: string
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

/**
 * Per-module native compile options. Module key is the source-file basename
 * (without extension) or cargo project directory name.
 *
 * frameworks: macOS framework names — passed as `-framework <name>` to clang
 * libs:       library short names — passed as `-l<name>`
 * includes:   header search dirs — passed as `-I<dir>` (relative paths
 *             resolve against the project root at compile time)
 * libDirs:    library search dirs — passed as `-L<dir>`
 * extraFlags: free-form additional compiler flags
 */
export type NativeModuleOptions = {
  frameworks?: string[]
  libs?: string[]
  includes?: string[]
  libDirs?: string[]
  extraFlags?: string[]
}

export type NativeOptions = Record<string, NativeModuleOptions>

export type Config = {
  window: WindowOptions
  build: BuildOptions
  bundle?: BundleOptions
  plugins?: string[]
  security?: SecurityOptions
  dev?: DevOptions
  splash?: string
  native?: NativeOptions
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
