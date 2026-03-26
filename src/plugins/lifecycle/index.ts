import type { Plugin, HostContext } from "../../types"

const host = (ctx: HostContext): void => {
  const emit = (action: string, data?: unknown) => {
    const runtime = globalThis.__butterRuntime
    if (runtime) {
      runtime.send(action, data ?? {})
    }
  }

  process.on("beforeExit", () => {
    emit("app:beforequit")
  })

  process.on("SIGHUP", () => {
    emit("app:willquit")
  })

  process.on("SIGTERM", () => {
    emit("app:willquit")
  })

  ctx.on("app:getinfo", () => {
    return {
      ok: true,
      version: process.env.BUTTER_VERSION ?? "0.0.0",
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
    }
  })

  ctx.on("app:activate", () => {
    emit("app:activate")
    return { ok: true }
  })

  ctx.on("app:reopen", () => {
    emit("app:reopen")
    return { ok: true }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  var listeners = {};
  function on(event, handler) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(handler);
  }
  if (window.__butterOn) {
    var events = ["app:activate", "app:beforequit", "app:willquit", "app:reopen"];
    events.forEach(function (evt) {
      window.__butterOn(evt, function (data) {
        if (listeners[evt]) {
          listeners[evt].forEach(function (fn) { fn(data); });
        }
      });
    });
  }
  window.butter.app = {
    onActivate: function (handler) {
      on("app:activate", handler);
    },
    onBeforeQuit: function (handler) {
      on("app:beforequit", handler);
    },
    onWillQuit: function (handler) {
      on("app:willquit", handler);
    },
    onReopen: function (handler) {
      on("app:reopen", handler);
    },
    getInfo: function () {
      return window.butter.invoke("app:getinfo");
    }
  };
})();
`

const lifecycle: Plugin = {
  name: "lifecycle",
  host,
  webview,
}

export default lifecycle
