import type { HostContext, Plugin } from "../../types";

const host = (ctx: HostContext): void => {
  ctx.on("nav:back", () => {
    const runtime = globalThis.__butterRuntime;
    if (runtime) {
      runtime.tell("nav:back");
    }
    return { ok: true };
  });

  ctx.on("nav:forward", () => {
    const runtime = globalThis.__butterRuntime;
    if (runtime) {
      runtime.tell("nav:forward");
    }
    return { ok: true };
  });

  ctx.on("nav:reload", () => {
    const runtime = globalThis.__butterRuntime;
    if (runtime) {
      runtime.tell("nav:reload");
    }
    return { ok: true };
  });

  ctx.on("nav:loadurl", (data: unknown) => {
    const url = typeof data === "string" ? data : ((data as { url: string })?.url ?? "");
    const runtime = globalThis.__butterRuntime;
    if (runtime) {
      runtime.tell("nav:loadurl", { url });
    }
    return { ok: true };
  });
};

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.nav = {
    back: function () {
      return window.butter.invoke("nav:back");
    },
    forward: function () {
      return window.butter.invoke("nav:forward");
    },
    reload: function () {
      return window.butter.invoke("nav:reload");
    },
    loadUrl: function (url) {
      return window.butter.invoke("nav:loadurl", { url: url });
    }
  };
})();
`;

const navigation: Plugin = {
  name: "navigation",
  host,
  webview,
};

export default navigation;
