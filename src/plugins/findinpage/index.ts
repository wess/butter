import type { Plugin, HostContext } from "../../types"

const host = (ctx: HostContext): void => {
  ctx.on("find:start", (data: unknown) => {
    const opts = data as { text: string; forward?: boolean; matchCase?: boolean }
    const text = opts?.text ?? ""
    const forward = opts?.forward ?? true
    const matchCase = opts?.matchCase ?? false
    const runtime = globalThis.__butterRuntime
    if (runtime) {
      runtime.control("find:start", { text, forward, matchCase })
    }
    return { ok: true }
  })

  ctx.on("find:stop", () => {
    const runtime = globalThis.__butterRuntime
    if (runtime) {
      runtime.control("find:stop")
    }
    return { ok: true }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.find = {
    start: function (text, opts) {
      return window.butter.invoke("find:start", {
        text: text,
        forward: opts && opts.forward !== undefined ? opts.forward : true,
        matchCase: opts && opts.matchCase !== undefined ? opts.matchCase : false
      });
    },
    stop: function () {
      return window.butter.invoke("find:stop");
    }
  };
})();
`

const findinpage: Plugin = {
  name: "findinpage",
  host,
  webview,
}

export default findinpage
