import type { Plugin, HostContext } from "../../types"

type ShortcutDefinition = {
  key: string
  modifiers?: Array<"cmd" | "ctrl" | "alt" | "shift">
}

type RegisterOptions = {
  shortcut: ShortcutDefinition
  id: string
}

// Registry of active shortcuts keyed by id.
// TODO: wire these into Carbon/CGEvent hotkey registration via Bun FFI.
// The Carbon API requires:
//   RegisterEventHotKey(keyCode, modifiers, hotkeyID, GetApplicationEventTarget(), 0, &hotkeyRef)
// and an event loop handler installed via InstallEventHandler.
// This requires the process to run a Carbon/AppKit event loop (main thread).
// For v0.1 the registry tracks registrations so the structure is in place.
const registry = new Map<string, RegisterOptions>()

const registerShortcut = (opts: RegisterOptions): void => {
  registry.set(opts.id, opts)
  // TODO: native Carbon hotkey registration
}

const unregisterShortcut = (id: string): void => {
  registry.delete(id)
  // TODO: native Carbon hotkey unregistration
}

const host = (ctx: HostContext): void => {
  ctx.on("shortcut:register", (data: unknown) => {
    const opts = data as RegisterOptions

    if (!opts?.id || !opts?.shortcut?.key) {
      return { ok: false, error: "id and shortcut.key are required" }
    }

    try {
      registerShortcut(opts)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("shortcut:unregister", (data: unknown) => {
    const id = typeof data === "string" ? data : (data as { id: string })?.id

    if (!id) {
      return { ok: false, error: "id is required" }
    }

    try {
      unregisterShortcut(id)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
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
