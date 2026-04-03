import type { Plugin, HostContext } from "../../types"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const ALLOWED_SCHEMES = ["http:", "https:", "mailto:"]

const validateUrl = (url: string): void => {
  try {
    const parsed = new URL(url)
    if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
      throw new Error(`URL scheme "${parsed.protocol}" is not allowed`)
    }
  } catch (err) {
    if (err instanceof TypeError) throw new Error("Invalid URL")
    throw err
  }
}

const validatePath = (path: string): string => {
  const resolved = resolve(path)
  if (!existsSync(resolved)) throw new Error("Path does not exist")
  return resolved
}

const openUrl = async (url: string): Promise<void> => {
  validateUrl(url)
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
  const safe = validatePath(path)
  const platform = process.platform
  if (platform === "darwin") {
    await Bun.$`open -R ${safe}`
  } else if (platform === "linux") {
    await Bun.$`xdg-open ${safe}`
  } else if (platform === "win32") {
    await Bun.$`explorer /select,${safe}`
  }
}

const openPath = async (path: string): Promise<void> => {
  const safe = validatePath(path)
  const platform = process.platform
  if (platform === "darwin") {
    await Bun.$`open ${safe}`
  } else if (platform === "linux") {
    await Bun.$`xdg-open ${safe}`
  } else if (platform === "win32") {
    await Bun.$`start ${safe}`
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
