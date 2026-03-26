import type { Plugin, HostContext } from "../../types"

type ShortcutDefinition = {
  key: string
  modifiers?: Array<"cmd" | "ctrl" | "alt" | "shift">
}

type RegisterOptions = {
  shortcut: ShortcutDefinition
  id: string
}

const registry = new Map<string, RegisterOptions>()

const host = (ctx: HostContext): void => {
  ctx.on("shortcut:register", (data: unknown) => {
    const opts = data as RegisterOptions

    if (!opts?.id || !opts?.shortcut?.key) {
      return { ok: false, error: "id and shortcut.key are required" }
    }

    registry.set(opts.id, opts)

    // Send control message to shim for native registration
    const runtime = globalThis.__butterRuntime
    if (runtime) {
      runtime.control("shortcut:register", opts)
    }

    return { ok: true }
  })

  ctx.on("shortcut:unregister", (data: unknown) => {
    const id = typeof data === "string" ? data : (data as { id: string })?.id

    if (!id) {
      return { ok: false, error: "id is required" }
    }

    registry.delete(id)

    const runtime = globalThis.__butterRuntime
    if (runtime) {
      runtime.control("shortcut:unregister", { id })
    }

    return { ok: true }
  })

  // Handle shortcut:triggered events from shim
  ctx.on("shortcut:triggered", (data: unknown) => {
    const { id } = data as { id: string }
    // Re-emit so host handlers can listen
    ctx.send("shortcut:triggered", { id })
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.shortcuts = {
    register: function (shortcut, id) {
      return window.butter.invoke("shortcut:register", { shortcut: shortcut, id: id });
    },
    unregister: function (id) {
      return window.butter.invoke("shortcut:unregister", id);
    }
  };
})();
`

const globalshortcuts: Plugin = {
  name: "globalshortcuts",
  host,
  webview,
}

export default globalshortcuts
