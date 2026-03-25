/*
 * System dialogs API for Butter apps.
 *
 * Dialogs run on the shim's main thread (required by macOS/GTK).
 * The host sends a control message, the shim opens the native panel,
 * and sends the result back as a response.
 *
 * Usage:
 *   import { dialog } from "butter/dialog"
 *
 *   const result = await dialog.open({
 *     title: "Select a file",
 *     filters: [{ name: "Images", extensions: ["png", "jpg"] }],
 *   })
 *
 *   if (!result.cancelled) {
 *     console.log(result.paths)
 *   }
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

const getRuntime = () => {
  if (!globalThis.__butterRuntime) throw new Error("Butter runtime not initialized")
  return globalThis.__butterRuntime
}

export const dialog = {
  open: (opts: OpenDialogOptions = {}): Promise<OpenDialogResult> =>
    getRuntime().control("dialog:open", opts) as Promise<OpenDialogResult>,

  save: (opts: SaveDialogOptions = {}): Promise<SaveDialogResult> =>
    getRuntime().control("dialog:save", opts) as Promise<SaveDialogResult>,

  folder: (opts: FolderDialogOptions = {}): Promise<FolderDialogResult> =>
    getRuntime().control("dialog:folder", opts) as Promise<FolderDialogResult>,
}
