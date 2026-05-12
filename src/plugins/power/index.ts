import type { Plugin, HostContext } from "../../types"

// Power, screen, and idle events. Shim emits:
//   power:sleep / power:wake               — system suspend/resume
//   power:screensleep / power:screenwake   — display off/on
//   power:lock / power:unlock              — user locked / unlocked
// And responds to:
//   power:idle      — { seconds }   seconds since last HID event
//   screen:list     — { screens[] } id, primary, scale, bounds, workArea
//
// macOS: full support. Linux & Windows: events not wired in the shim yet —
// the plugin still exposes the JS API so user code is portable; events
// just won't fire on those platforms until shim hooks are added.

const host = (ctx: HostContext): void => {
  ctx.on("power:idle", async () => {
    const runtime = globalThis.__butterRuntime
    if (!runtime) return { ok: false, error: "runtime not initialized" }
    try {
      const result = await runtime.control("power:idle")
      return result ?? { ok: false }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("screen:list", async () => {
    const runtime = globalThis.__butterRuntime
    if (!runtime) return { ok: false, error: "runtime not initialized" }
    try {
      const result = await runtime.control("screen:list")
      return result ?? { ok: false }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  var listeners = {};
  function bind(evt) {
    if (window.__butterOn) {
      window.__butterOn(evt, function (d) {
        (listeners[evt] || []).forEach(function (fn) { try { fn(d); } catch (e) {} });
      });
    }
  }
  ["power:sleep", "power:wake", "power:screensleep", "power:screenwake", "power:lock", "power:unlock"]
    .forEach(bind);
  function add(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  window.butter.power = {
    onSleep:       function (fn) { add("power:sleep", fn); },
    onWake:        function (fn) { add("power:wake", fn); },
    onScreenSleep: function (fn) { add("power:screensleep", fn); },
    onScreenWake:  function (fn) { add("power:screenwake", fn); },
    onLock:        function (fn) { add("power:lock", fn); },
    onUnlock:      function (fn) { add("power:unlock", fn); },
    idleSeconds:   function () {
      return window.butter.invoke("power:idle").then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || "power:idle failed");
        return r.seconds;
      });
    }
  };
  window.butter.screen = {
    list: function () {
      return window.butter.invoke("screen:list").then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || "screen:list failed");
        return r.screens;
      });
    }
  };
})();
`

const power: Plugin = {
  name: "power",
  host,
  webview,
}

export default power
