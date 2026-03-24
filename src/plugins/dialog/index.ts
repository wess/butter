import type { Plugin, HostContext } from "../../types"
import { openDialog, saveDialog } from "./native"

type OpenDialogOptions = {
  multiple?: boolean
  fileTypes?: string[]
  prompt?: string
}

type SaveDialogOptions = {
  defaultName?: string
  prompt?: string
}

const host = (ctx: HostContext): void => {
  ctx.on("dialog:open", async (data: unknown) => {
    const opts = (data ?? {}) as OpenDialogOptions
    const paths = await openDialog(opts)
    return { paths }
  })

  ctx.on("dialog:save", async (data: unknown) => {
    const opts = (data ?? {}) as SaveDialogOptions
    const path = await saveDialog(opts)
    return { path }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.dialog = {
    open: function (opts) {
      return window.butter.invoke("dialog:open", opts || {});
    },
    save: function (opts) {
      return window.butter.invoke("dialog:save", opts || {});
    }
  };
})();
`

const dialog: Plugin = {
  name: "dialog",
  host,
  webview,
}

export default dialog
