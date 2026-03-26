import type { Plugin, HostContext } from "../../types"

const host = (ctx: HostContext): void => {
  // Announce sends a message to the webview's ARIA live region
  ctx.on("a11y:announce", (data: unknown) => {
    const opts = data as { message: string; priority?: "polite" | "assertive" }
    if (!opts?.message) return { ok: false, error: "message required" }
    ctx.send("a11y:announce", opts)
    return { ok: true }
  })

  // Set the document title (used by screen readers)
  ctx.on("a11y:title", (data: unknown) => {
    const title = typeof data === "string" ? data : (data as { title: string })?.title
    if (title) ctx.send("a11y:title", { title })
    return { ok: true }
  })

  // Focus a specific element by selector
  ctx.on("a11y:focus", (data: unknown) => {
    const selector = typeof data === "string" ? data : (data as { selector: string })?.selector
    if (selector) ctx.send("a11y:focus", { selector })
    return { ok: true }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};

  // Create ARIA live regions for announcements
  var politeRegion = document.createElement("div");
  politeRegion.setAttribute("role", "status");
  politeRegion.setAttribute("aria-live", "polite");
  politeRegion.setAttribute("aria-atomic", "true");
  politeRegion.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";

  var assertiveRegion = document.createElement("div");
  assertiveRegion.setAttribute("role", "alert");
  assertiveRegion.setAttribute("aria-live", "assertive");
  assertiveRegion.setAttribute("aria-atomic", "true");
  assertiveRegion.style.cssText = politeRegion.style.cssText;

  function init() {
    document.body.appendChild(politeRegion);
    document.body.appendChild(assertiveRegion);
  }

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init);

  butter.on("a11y:announce", function (data) {
    var region = data.priority === "assertive" ? assertiveRegion : politeRegion;
    region.textContent = "";
    setTimeout(function () { region.textContent = data.message; }, 50);
  });

  butter.on("a11y:title", function (data) {
    document.title = data.title;
  });

  butter.on("a11y:focus", function (data) {
    var el = document.querySelector(data.selector);
    if (el && el.focus) el.focus();
  });

  window.butter.a11y = {
    announce: function (message, priority) {
      return window.butter.invoke("a11y:announce", { message: message, priority: priority || "polite" });
    },
    setTitle: function (title) {
      return window.butter.invoke("a11y:title", { title: title });
    },
    focus: function (selector) {
      return window.butter.invoke("a11y:focus", { selector: selector });
    }
  };
})();
`

const accessibility: Plugin = {
  name: "accessibility",
  host,
  webview,
}

export default accessibility
