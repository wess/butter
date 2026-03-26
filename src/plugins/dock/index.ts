import type { Plugin, HostContext } from "../../types"

const host = (ctx: HostContext): void => {
  ctx.on("dock:setbadge", (data: unknown) => {
    const text = typeof data === "string" ? data : (data as { text: string })?.text ?? ""
    const runtime = globalThis.__butterRuntime
    if (runtime) {
      runtime.control("dock:setbadge", { text })
    }
    return { ok: true }
  })

  ctx.on("dock:bounce", (data: unknown) => {
    const type = typeof data === "string"
      ? data
      : (data as { type: string })?.type ?? "informational"
    const runtime = globalThis.__butterRuntime
    if (runtime) {
      runtime.control("dock:bounce", { type })
    }
    return { ok: true }
  })

  ctx.on("dock:setprogress", (data: unknown) => {
    const progress = typeof data === "number"
      ? data
      : (data as { progress: number })?.progress ?? 0
    const runtime = globalThis.__butterRuntime
    if (runtime) {
      runtime.control("dock:setprogress", { progress })
    }
    return { ok: true }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.dock = {
    setBadge: function (text) {
      return window.butter.invoke("dock:setbadge", { text: text });
    },
    bounce: function (type) {
      return window.butter.invoke("dock:bounce", { type: type || "informational" });
    },
    setProgress: function (progress) {
      return window.butter.invoke("dock:setprogress", { progress: progress });
    }
  };
})();
`

const dock: Plugin = {
  name: "dock",
  host,
  webview,
}

export default dock
