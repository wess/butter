import type { Plugin, HostContext } from "../../types"
import { execSync } from "child_process"

const checkOnline = (): boolean => {
  try {
    execSync("ping -c 1 -W 2 1.1.1.1", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const host = (ctx: HostContext): void => {
  let lastStatus = checkOnline()

  ctx.on("network:status", () => {
    return { online: checkOnline() }
  })

  // Poll every 5 seconds
  setInterval(() => {
    const current = checkOnline()
    if (current !== lastStatus) {
      lastStatus = current
      ctx.send("network:change", { online: current })
    }
  }, 5000)
}

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
`

const network: Plugin = {
  name: "network",
  host,
  webview,
}

export default network
