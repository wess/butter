import type { Plugin, HostContext } from "../../types"

const readClipboard = async (): Promise<string> => {
  const platform = process.platform
  if (platform === "darwin") {
    return await Bun.$`pbpaste`.text()
  } else if (platform === "linux") {
    return await Bun.$`xclip -selection clipboard -o`.text()
  } else if (platform === "win32") {
    return await Bun.$`powershell -Command Get-Clipboard`.text()
  }
  return ""
}

const writeClipboard = async (text: string): Promise<void> => {
  const platform = process.platform
  if (platform === "darwin") {
    await Bun.$`echo ${text}`.pipe(Bun.$`pbcopy`)
  } else if (platform === "linux") {
    await Bun.$`echo ${text}`.pipe(Bun.$`xclip -selection clipboard`)
  } else if (platform === "win32") {
    await Bun.$`powershell -Command Set-Clipboard -Value ${text}`
  }
}

const host = (ctx: HostContext): void => {
  ctx.on("clipboard:read", async (_data: unknown) => {
    try {
      const text = await readClipboard()
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("clipboard:write", async (data: unknown) => {
    const text = typeof data === "string" ? data : (data as { text: string })?.text ?? ""

    try {
      await writeClipboard(text)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.clipboard = {
    read: function () {
      return window.butter.invoke("clipboard:read");
    },
    write: function (text) {
      return window.butter.invoke("clipboard:write", text);
    }
  };
})();
`

const clipboard: Plugin = {
  name: "clipboard",
  host,
  webview,
}

export default clipboard
