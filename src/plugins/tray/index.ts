import type { Plugin, HostContext } from "../../types"

type TrayItem =
  | { label: string; action: string }
  | { separator: true }

type TrayOptions = {
  title?: string
  tooltip?: string
  items?: TrayItem[]
}

const host = (ctx: HostContext): void => {
  ctx.on("tray:set", (data: unknown) => {
    const opts = data as TrayOptions
    const runtime = globalThis.__butterRuntime
    if (runtime) {
      runtime.control("tray:set", opts)
    }
    return { ok: true }
  })

  ctx.on("tray:remove", () => {
    const runtime = globalThis.__butterRuntime
    if (runtime) {
      runtime.control("tray:remove")
    }
    return { ok: true }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.tray = {
    set: function (opts) {
      return window.butter.invoke("tray:set", opts);
    },
    remove: function () {
      return window.butter.invoke("tray:remove");
    }
  };
})();
`

const tray: Plugin = {
  name: "tray",
  host,
  webview,
}

export default tray
