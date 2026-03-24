import type { Plugin, HostContext } from "../../types"

type TrayItem = {
  label: string
  action: string
}

type TrayOptions = {
  title?: string
  items?: TrayItem[]
}

const host = (ctx: HostContext): void => {
  ctx.on("tray:set", (data: unknown) => {
    const opts = data as TrayOptions

    // Attempt native tray via FFI on macOS; fall back gracefully
    try {
      const { initTray, setTrayTitle } = require("./native")

      if (opts.title) {
        setTrayTitle(opts.title)
      } else {
        initTray({
          title: opts.title ?? "",
          items: opts.items ?? [],
          onAction: (action: string) => ctx.send("tray:action", { action }),
        })
      }
    } catch {
      // FFI unavailable in this environment; no-op
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
