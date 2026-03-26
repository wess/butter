import type { Plugin, HostContext } from "../../types"

type NotifyOptions = {
  title: string
  body: string
  subtitle?: string
}

const sendNotification = async (opts: NotifyOptions): Promise<void> => {
  const title = opts.title.replace(/"/g, '\\"')
  const body = opts.body.replace(/"/g, '\\"')
  const platform = process.platform

  if (platform === "darwin") {
    const subtitleClause = opts.subtitle
      ? ` subtitle "${opts.subtitle.replace(/"/g, '\\"')}"`
      : ""
    const script = `display notification "${body}" with title "${title}"${subtitleClause}`
    await Bun.$`osascript -e ${script}`.quiet()
  } else if (platform === "linux") {
    const args = opts.subtitle ? [title, `${opts.subtitle}\n${body}`] : [title, body]
    await Bun.$`notify-send ${args[0]} ${args[1]}`.quiet()
  } else if (platform === "win32") {
    const ps = `[void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(5000, '${title}', '${body}', 'Info'); Start-Sleep -Seconds 1; $n.Dispose()`
    await Bun.$`powershell -Command ${ps}`.quiet()
  }
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
