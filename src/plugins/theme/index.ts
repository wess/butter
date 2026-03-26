import type { Plugin, HostContext } from "../../types"

const detectTheme = async (): Promise<"dark" | "light"> => {
  const platform = process.platform
  try {
    if (platform === "darwin") {
      const result = await Bun.$`defaults read -g AppleInterfaceStyle`.text()
      return result.trim().toLowerCase() === "dark" ? "dark" : "light"
    } else if (platform === "linux") {
      try {
        const result =
          await Bun.$`gsettings get org.gnome.desktop.interface color-scheme`.text()
        if (result.includes("dark")) return "dark"
      } catch {
        const gtkTheme = process.env.GTK_THEME ?? ""
        if (gtkTheme.toLowerCase().includes("dark")) return "dark"
      }
      return "light"
    } else if (platform === "win32") {
      const result =
        await Bun.$`powershell -Command (Get-ItemProperty -Path HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize).AppsUseLightTheme`.text()
      return result.trim() === "0" ? "dark" : "light"
    }
  } catch {
    return "light"
  }
  return "light"
}

const host = (ctx: HostContext): void => {
  let lastTheme: "dark" | "light" | null = null

  ctx.on("theme:get", async (_data: unknown) => {
    try {
      const theme = await detectTheme()
      lastTheme = theme
      return { ok: true, theme }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  const poll = async () => {
    try {
      const theme = await detectTheme()
      if (lastTheme !== null && theme !== lastTheme) {
        ctx.send("theme:changed", { theme })
      }
      lastTheme = theme
    } catch {
      // ignore polling errors
    }
  }

  setInterval(poll, 5000)
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  var listeners = [];
  window.butter.theme = {
    get: function () {
      return window.butter.invoke("theme:get");
    },
    onChange: function (handler) {
      listeners.push(handler);
    }
  };
  window.butter.on("theme:changed", function (data) {
    listeners.forEach(function (fn) { fn(data); });
  });
})();
`

const theme: Plugin = {
  name: "theme",
  host,
  webview,
}

export default theme
