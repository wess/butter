import type { HostContext, Plugin } from "../../types";

// Cross-platform online check: a HEAD request to a small, well-known endpoint.
// Previously used `execSync("ping ...")` which (a) blocked the event loop,
// (b) used POSIX-only flags so always reported offline on Windows.
const PROBE_URL = "https://1.1.1.1/cdn-cgi/trace";
const PROBE_TIMEOUT_MS = 2000;

const checkOnline = async (): Promise<boolean> => {
  try {
    const ctrl = AbortSignal.timeout(PROBE_TIMEOUT_MS);
    const res = await fetch(PROBE_URL, { method: "HEAD", signal: ctrl });
    return res.ok || res.status === 405; // some endpoints reject HEAD; either way we got bytes back
  } catch {
    return false;
  }
};

const host = (ctx: HostContext): void => {
  let lastStatus = false;
  // Seed the first reading without blocking host startup.
  checkOnline()
    .then((s) => {
      lastStatus = s;
    })
    .catch(() => {});

  ctx.on("network:status", async () => {
    const online = await checkOnline();
    return { online };
  });

  // Poll every 5 seconds. unref() so the interval doesn't keep the process
  // alive on its own.
  const handle = setInterval(async () => {
    const current = await checkOnline();
    if (current !== lastStatus) {
      lastStatus = current;
      ctx.send("network:change", { online: current });
    }
  }, 5000);
  handle.unref?.();
};

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.network = {
    status: function () {
      return window.butter.invoke("network:status");
    }
  };
  window.addEventListener("online", function () {
    var h = window.butter._networkHandlers || [];
    for (var i = 0; i < h.length; i++) h[i]({ online: true });
  });
  window.addEventListener("offline", function () {
    var h = window.butter._networkHandlers || [];
    for (var i = 0; i < h.length; i++) h[i]({ online: false });
  });
  butter.on("network:change", function (data) {
    var h = window.butter._networkHandlers || [];
    for (var i = 0; i < h.length; i++) h[i](data);
  });
  window.butter.network.onChange = function (handler) {
    if (!window.butter._networkHandlers) window.butter._networkHandlers = [];
    window.butter._networkHandlers.push(handler);
  };
})();
`;

const network: Plugin = {
  name: "network",
  host,
  webview,
};

export default network;
