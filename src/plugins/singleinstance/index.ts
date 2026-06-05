import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostContext, Plugin } from "../../types";

// A second instance writes its argv+cwd to the leader over a per-app TCP
// loopback server, then exits. The leader emits `app:secondinstance` for the
// host code (and webview, via __butterOn) to react — typically by raising
// the window and forwarding the args.

type LockData = { pid: number; port: number };

const SAFE_ID = /^[a-zA-Z0-9._-]+$/;

const lockFilePath = (appId: string): string => {
  if (!SAFE_ID.test(appId)) {
    throw new Error("app id must match [a-zA-Z0-9._-]");
  }
  return join(tmpdir(), `butter-singleinstance-${appId}.lock`);
};

const isAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

const readLock = (path: string): LockData | null => {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LockData;
    if (typeof parsed.pid !== "number" || typeof parsed.port !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const notifyLeader = async (data: LockData, payload: unknown): Promise<boolean> => {
  try {
    const res = await fetch(`http://127.0.0.1:${data.port}/raise`, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
};

const startLeaderServer = (
  onSecondInstance: (data: unknown) => void,
): { port: number; stop: () => void } => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      if (new URL(req.url).pathname !== "/raise") {
        return new Response("not found", { status: 404 });
      }
      try {
        const data = await req.json();
        onSecondInstance(data);
        return new Response("ok");
      } catch {
        return new Response("bad", { status: 400 });
      }
    },
  });
  return { port: server.port!, stop: () => server.stop(true) };
};

const host = (ctx: HostContext): void => {
  const appId = (process.env.BUTTER_APP_ID || "default").replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = lockFilePath(appId);
  const existing = readLock(path);

  if (existing && isAlive(existing.pid) && existing.pid !== process.pid) {
    const payload = { argv: process.argv.slice(2), cwd: process.cwd() };
    notifyLeader(existing, payload).finally(() => {
      console.log(`Another instance is already running (pid ${existing.pid}). Exiting.`);
      process.exit(0);
    });
    return;
  }

  if (existing) {
    try {
      unlinkSync(path);
    } catch {
      /* stale */
    }
  }

  const srv = startLeaderServer((data) => {
    ctx.send("app:secondinstance", data ?? {});
  });

  writeFileSync(path, JSON.stringify({ pid: process.pid, port: srv.port }));

  const cleanup = () => {
    try {
      srv.stop();
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  ctx.on("singleinstance:isleader", () => ({ ok: true, leader: true }));
};

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  var handlers = [];
  if (window.__butterOn) {
    window.__butterOn("app:secondinstance", function (data) {
      handlers.forEach(function (fn) { try { fn(data); } catch (e) {} });
    });
  }
  window.butter.singleInstance = {
    onSecondInstance: function (fn) { handlers.push(fn); },
    isLeader: function () { return window.butter.invoke("singleinstance:isleader"); }
  };
})();
`;

const singleinstance: Plugin = {
  name: "singleinstance",
  host,
  webview,
};

export default singleinstance;
