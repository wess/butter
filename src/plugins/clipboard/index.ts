import type { Plugin, HostContext } from "../../types"

const readClipboard = async (): Promise<string> => {
  const result = await Bun.$`pbpaste`.text()
  return result
}

const writeClipboard = async (text: string): Promise<void> => {
  await Bun.$`echo ${text}`.pipe(Bun.$`pbcopy`)
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
