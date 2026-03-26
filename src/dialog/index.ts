/*
 * System dialogs API for Butter apps.
 *
 * Works on both host and webview sides:
 * - Host: sends a control message through the runtime
 * - Webview: calls butter.invoke() which the shim intercepts natively
 *
 * Usage (webview — React, vanilla JS, etc.):
 *   import { dialog } from "butter/dialog"
 *
 *   const result = await dialog.save({
 *     defaultName: "export.csv",
 *     filters: [
 *       { name: "CSV", extensions: ["csv"] },
 *       { name: "JSON", extensions: ["json"] },
 *     ],
 *   })
 *
 *   if (!result.cancelled) {
 *     console.log(result.path)
 *   }
 *
 * Usage (host):
 *   import { dialog } from "butter/dialog"
 *   // Same API — automatically detects host vs webview context
 */

export type FileFilter = {
  name: string
  extensions: string[]
}

export type OpenDialogOptions = {
  title?: string
  prompt?: string
  defaultPath?: string
  multiple?: boolean
  filters?: FileFilter[]
}

export type SaveDialogOptions = {
  title?: string
  prompt?: string
  defaultPath?: string
  defaultName?: string
  filters?: FileFilter[]
}

export type FolderDialogOptions = {
  title?: string
  prompt?: string
  defaultPath?: string
  multiple?: boolean
}

export type OpenDialogResult = {
  paths: string[]
  cancelled: boolean
}

export type SaveDialogResult = {
  path: string
  cancelled: boolean
}

export type FolderDialogResult = {
  paths: string[]
  cancelled: boolean
}

export type MessageDialogOptions = {
  title?: string
  message: string
  detail?: string
  type?: "info" | "warning" | "error"
  buttons?: string[]
}

export type MessageDialogResult = {
  button: number
  cancelled: boolean
}

const isWebview = (): boolean =>
  typeof globalThis.__butterRuntime === "undefined" &&
  typeof (globalThis as any).butter?.invoke === "function"

const isHost = (): boolean =>
  typeof globalThis.__butterRuntime !== "undefined"

const invokeFromWebview = (action: string, data: unknown): Promise<unknown> =>
  (globalThis as any).butter.invoke(action, data)

const invokeFromHost = (action: string, data: unknown): Promise<unknown> => {
  if (!globalThis.__butterRuntime) throw new Error("Butter runtime not initialized")
  return (globalThis.__butterRuntime as any).control(action, data)
}

const invoke = (action: string, data: unknown): Promise<unknown> => {
  if (isWebview()) return invokeFromWebview(action, data)
  if (isHost()) return invokeFromHost(action, data)
  throw new Error("butter/dialog: not running in a Butter context (no runtime or webview bridge found)")
}

const normalizeBool = (v: unknown): boolean =>
  v === true || v === "true"

export const dialog = {
  /**
   * Show an open file dialog.
   *
   * @example
   * const result = await dialog.open({
   *   title: "Select a file",
   *   filters: [{ name: "Images", extensions: ["png", "jpg", "gif"] }],
   *   multiple: true,
   * })
   * if (!result.cancelled) {
   *   for (const path of result.paths) { ... }
   * }
   */
  open: async (opts: OpenDialogOptions = {}): Promise<OpenDialogResult> => {
    const raw = await invoke("dialog:open", opts) as any
    return {
      paths: Array.isArray(raw?.paths) ? raw.paths : [],
      cancelled: normalizeBool(raw?.cancelled) || !(raw?.paths?.length),
    }
  },

  /**
   * Show a save file dialog.
   *
   * @example
   * const result = await dialog.save({
   *   defaultName: "data.csv",
   *   filters: [
   *     { name: "CSV", extensions: ["csv"] },
   *     { name: "JSON", extensions: ["json"] },
   *   ],
   * })
   * if (!result.cancelled) {
   *   console.log("Save to:", result.path)
   * }
   */
  save: async (opts: SaveDialogOptions = {}): Promise<SaveDialogResult> => {
    const raw = await invoke("dialog:save", opts) as any
    const path = raw?.path || ""
    return {
      path,
      cancelled: normalizeBool(raw?.cancelled) || !path,
    }
  },

  /**
   * Show a folder selection dialog.
   *
   * @example
   * const result = await dialog.folder({ prompt: "Choose output directory" })
   * if (!result.cancelled) {
   *   console.log("Selected:", result.paths[0])
   * }
   */
  folder: async (opts: FolderDialogOptions = {}): Promise<FolderDialogResult> => {
    const raw = await invoke("dialog:folder", opts) as any
    return {
      paths: Array.isArray(raw?.paths) ? raw.paths : [],
      cancelled: normalizeBool(raw?.cancelled) || !(raw?.paths?.length),
    }
  },

  /**
   * Show a message dialog (alert/confirm).
   *
   * @example
   * const result = await dialog.message({
   *   title: "Confirm",
   *   message: "Are you sure?",
   *   type: "warning",
   *   buttons: ["Cancel", "OK"],
   * })
   * if (result.button === 1) { ... }
   */
  message: async (opts: MessageDialogOptions): Promise<MessageDialogResult> => {
    const raw = await invoke("dialog:message", opts) as any
    return {
      button: typeof raw?.button === "number" ? raw.button : 0,
      cancelled: normalizeBool(raw?.cancelled),
    }
  },

  /**
   * Show a simple alert dialog.
   */
  alert: async (message: string, title = "Alert"): Promise<void> => {
    await invoke("dialog:message", { title, message, type: "info", buttons: ["OK"] })
  },

  /**
   * Show a confirm dialog. Returns true if confirmed.
   */
  confirm: async (message: string, title = "Confirm"): Promise<boolean> => {
    const raw = await invoke("dialog:message", { title, message, type: "info", buttons: ["Cancel", "OK"] }) as any
    return raw?.button === 1
  },
}
