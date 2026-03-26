import type { Plugin, HostContext } from "../../types"

const openUrl = async (url: string): Promise<void> => {
  const platform = process.platform
  if (platform === "darwin") {
    await Bun.$`open ${url}`
  } else if (platform === "linux") {
    await Bun.$`xdg-open ${url}`
  } else if (platform === "win32") {
    await Bun.$`start ${url}`
  }
}

const showInFolder = async (path: string): Promise<void> => {
  const platform = process.platform
  if (platform === "darwin") {
    await Bun.$`open -R ${path}`
  } else if (platform === "linux") {
    await Bun.$`xdg-open ${path}`
  } else if (platform === "win32") {
    await Bun.$`explorer /select,${path}`
  }
}

const openPath = async (path: string): Promise<void> => {
  const platform = process.platform
  if (platform === "darwin") {
    await Bun.$`open ${path}`
  } else if (platform === "linux") {
    await Bun.$`xdg-open ${path}`
  } else if (platform === "win32") {
    await Bun.$`start ${path}`
  }
}

const host = (ctx: HostContext): void => {
  ctx.on("shell:openurl", async (data: unknown) => {
    const url = typeof data === "string" ? data : (data as { url: string })?.url ?? ""
    try {
      await openUrl(url)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("shell:showinfolder", async (data: unknown) => {
    const path = typeof data === "string" ? data : (data as { path: string })?.path ?? ""
    try {
      await showInFolder(path)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("shell:openpath", async (data: unknown) => {
    const path = typeof data === "string" ? data : (data as { path: string })?.path ?? ""
    try {
      await openPath(path)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.shell = {
    openUrl: function (url) {
      return window.butter.invoke("shell:openurl", { url: url });
    },
    showInFolder: function (path) {
      return window.butter.invoke("shell:showinfolder", { path: path });
    },
    openPath: function (path) {
      return window.butter.invoke("shell:openpath", { path: path });
    }
  };
})();
`

const shell: Plugin = {
  name: "shell",
  host,
  webview,
}

export default shell
