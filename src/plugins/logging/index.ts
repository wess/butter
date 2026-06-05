import { existsSync, mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { HostContext, Plugin } from "../../types";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogEntry = {
  level: LogLevel;
  message: string;
  data?: unknown;
};

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let logFile: string | null = null;
let minLevel: LogLevel = "info";
let fileWriteFailed = false;

// Serialize file writes so they stay in order even when multiple log calls
// happen concurrently. Each call appends to the chain rather than racing
// the underlying fs handle.
let fileWriteChain: Promise<void> = Promise.resolve();

const formatEntry = (entry: LogEntry): string => {
  const ts = new Date().toISOString();
  const data = entry.data !== undefined ? ` ${JSON.stringify(entry.data)}` : "";
  return `[${ts}] [${entry.level.toUpperCase()}] ${entry.message}${data}\n`;
};

const writeLog = (entry: LogEntry): void => {
  if (LOG_LEVELS[entry.level] < LOG_LEVELS[minLevel]) {
    return;
  }

  const formatted = formatEntry(entry);

  if (entry.level === "error") {
    process.stderr.write(formatted);
  } else {
    process.stdout.write(formatted);
  }

  if (logFile) {
    const path = logFile;
    fileWriteChain = fileWriteChain.then(() =>
      appendFile(path, formatted).catch((err) => {
        if (!fileWriteFailed) {
          fileWriteFailed = true;
          process.stderr.write(
            `[logging] failed writing to ${path}: ${err instanceof Error ? err.message : String(err)} (further errors silenced)\n`,
          );
        }
      }),
    );
  }
};

const host = (ctx: HostContext): void => {
  ctx.on("log:configure", (data: unknown) => {
    const opts = data as { file?: string; level?: LogLevel };
    if (opts?.file) {
      const dir = join(opts.file, "..");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      logFile = opts.file;
      fileWriteFailed = false;
    }
    if (opts?.level && opts.level in LOG_LEVELS) {
      minLevel = opts.level;
    }
    return { ok: true };
  });

  ctx.on("log:write", (data: unknown) => {
    const entry = data as LogEntry;
    if (!entry?.level || !entry?.message) {
      return { ok: false, error: "level and message required" };
    }
    writeLog(entry);
    return { ok: true };
  });
};

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.log = {
    debug: function (msg, data) {
      return window.butter.invoke("log:write", { level: "debug", message: msg, data: data });
    },
    info: function (msg, data) {
      return window.butter.invoke("log:write", { level: "info", message: msg, data: data });
    },
    warn: function (msg, data) {
      return window.butter.invoke("log:write", { level: "warn", message: msg, data: data });
    },
    error: function (msg, data) {
      return window.butter.invoke("log:write", { level: "error", message: msg, data: data });
    },
    configure: function (opts) {
      return window.butter.invoke("log:configure", opts);
    }
  };
})();
`;

const logging: Plugin = {
  name: "logging",
  host,
  webview,
};

export default logging;
