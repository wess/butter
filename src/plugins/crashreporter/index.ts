import { join } from "path"
import { appendFileSync, mkdirSync, existsSync } from "fs"
import { tmpdir } from "os"
import type { Plugin, HostContext } from "../../types"

type CrashReport = {
  timestamp: string
  type: "uncaughtException" | "unhandledRejection" | "webview"
  message: string
  stack?: string
}

let crashDir = join(tmpdir(), "butter-crashes")
let reportUrl: string | null = null
const reports: CrashReport[] = []

const writeCrash = (report: CrashReport): void => {
  reports.push(report)

  if (!existsSync(crashDir)) mkdirSync(crashDir, { recursive: true })
  const filename = `crash-${Date.now()}.json`
  const path = join(crashDir, filename)

  try {
    appendFileSync(path, JSON.stringify(report, null, 2))
  } catch {
    // best effort
  }

  process.stderr.write(`[CRASH] ${report.type}: ${report.message}\n`)

  if (reportUrl) {
    fetch(reportUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    }).catch(() => {})
  }
}

const host = (ctx: HostContext): void => {
  // Catch host-side unhandled errors
  process.on("uncaughtException", (err) => {
    writeCrash({
      timestamp: new Date().toISOString(),
      type: "uncaughtException",
      message: err.message,
      stack: err.stack,
    })
  })

  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    writeCrash({
      timestamp: new Date().toISOString(),
      type: "unhandledRejection",
      message: msg,
      stack,
    })
  })

  ctx.on("crash:configure", (data: unknown) => {
    const opts = data as { dir?: string; url?: string }
    if (opts?.dir) crashDir = opts.dir
    if (opts?.url) reportUrl = opts.url
    return { ok: true }
  })

  ctx.on("crash:report", (data: unknown) => {
    const report = data as { message: string; stack?: string }
    writeCrash({
      timestamp: new Date().toISOString(),
      type: "webview",
      message: report?.message ?? "Unknown error",
      stack: report?.stack,
    })
    return { ok: true }
  })

  ctx.on("crash:list", () => {
    return { ok: true, reports }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.crash = {
    report: function (err) {
      var msg = err instanceof Error ? err.message : String(err);
      var stack = err instanceof Error ? err.stack : undefined;
      return window.butter.invoke("crash:report", { message: msg, stack: stack });
    },
    configure: function (opts) {
      return window.butter.invoke("crash:configure", opts);
    }
  };
  window.addEventListener("error", function (e) {
    window.butter.invoke("crash:report", {
      message: e.message || "Unknown error",
      stack: e.error ? e.error.stack : (e.filename + ":" + e.lineno)
    });
  });
  window.addEventListener("unhandledrejection", function (e) {
    var msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
    var stack = e.reason instanceof Error ? e.reason.stack : undefined;
    window.butter.invoke("crash:report", { message: msg, stack: stack });
  });
})();
`

const crashreporter: Plugin = {
  name: "crashreporter",
  host,
  webview,
}

export default crashreporter
