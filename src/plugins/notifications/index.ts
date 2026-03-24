import type { Plugin, HostContext } from "../../types"

type NotifyOptions = {
  title: string
  body: string
  subtitle?: string
}

const sendNotification = async (opts: NotifyOptions): Promise<void> => {
  const title = opts.title.replace(/"/g, '\\"')
  const body = opts.body.replace(/"/g, '\\"')

  const subtitleClause = opts.subtitle
    ? ` subtitle "${opts.subtitle.replace(/"/g, '\\"')}"`
    : ""

  const script = `display notification "${body}" with title "${title}"${subtitleClause}`

  await Bun.$`osascript -e ${script}`.quiet()
}

const host = (ctx: HostContext): void => {
  ctx.on("notify:send", async (data: unknown) => {
    const opts = data as NotifyOptions

    if (!opts?.title || !opts?.body) {
      return { ok: false, error: "title and body are required" }
    }

    try {
      await sendNotification(opts)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.notify = {
    send: function (opts) {
      return window.butter.invoke("notify:send", opts);
    }
  };
})();
`

const notifications: Plugin = {
  name: "notifications",
  host,
  webview,
}

export default notifications
