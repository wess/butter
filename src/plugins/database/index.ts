import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { HostContext, Plugin } from "../../types";

// SQLite plugin. The webview asks for a named DB; the host opens it under the
// platform's per-user app-data dir (or :memory: for in-memory). Statements
// run on the host so the webview never touches a sqlite handle directly.

type OpenParams = { name: string; readonly?: boolean };
type ExecParams = { handle: string; sql: string; params?: unknown[] };
type QueryParams = ExecParams;

const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;

const databases = new Map<string, Database>();
let nextHandle = 1;

const appId = (): string =>
  (process.env.BUTTER_APP_ID || process.env.BUTTER_TITLE || "butterapp").replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  );

const dataDir = (): string => {
  const id = appId();
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", id);
  }
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), id);
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), id);
};

const dbPath = (name: string): string => {
  if (name === ":memory:") {
    return ":memory:";
  }
  if (!SAFE_NAME.test(name)) {
    throw new Error(`db name must match [a-zA-Z0-9._-]: ${name}`);
  }
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.sqlite`);
};

const open = (name: string, readonly: boolean): string => {
  const path = dbPath(name);
  const db = new Database(path, readonly ? { readonly: true } : { create: true });
  const handle = `db_${nextHandle++}`;
  databases.set(handle, db);
  return handle;
};

const getDb = (handle: string): Database => {
  const db = databases.get(handle);
  if (!db) {
    throw new Error(`unknown db handle: ${handle}`);
  }
  return db;
};

const host = (ctx: HostContext): void => {
  ctx.on("db:open", (data: unknown) => {
    const { name, readonly } = data as OpenParams;
    if (!name) {
      return { ok: false, error: "name is required" };
    }
    try {
      return { ok: true, handle: open(name, !!readonly) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ctx.on("db:close", (data: unknown) => {
    const { handle } = data as { handle: string };
    const db = databases.get(handle);
    if (!db) {
      return { ok: false, error: "unknown handle" };
    }
    try {
      db.close();
      databases.delete(handle);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ctx.on("db:exec", (data: unknown) => {
    const { handle, sql, params } = data as ExecParams;
    try {
      const stmt = getDb(handle).prepare(sql);
      const result = stmt.run(...((params ?? []) as []));
      return { ok: true, changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ctx.on("db:query", (data: unknown) => {
    const { handle, sql, params } = data as QueryParams;
    try {
      const rows = getDb(handle)
        .prepare(sql)
        .all(...((params ?? []) as []));
      return { ok: true, rows };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ctx.on("db:get", (data: unknown) => {
    const { handle, sql, params } = data as QueryParams;
    try {
      const row = getDb(handle)
        .prepare(sql)
        .get(...((params ?? []) as []));
      return { ok: true, row: row ?? null };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
};

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  function unwrap(p) {
    return p.then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || "db error");
      return r;
    });
  }
  function Connection(handle) {
    this.handle = handle;
  }
  Connection.prototype.exec = function (sql, params) {
    return unwrap(window.butter.invoke("db:exec", { handle: this.handle, sql: sql, params: params || [] }));
  };
  Connection.prototype.query = function (sql, params) {
    return unwrap(window.butter.invoke("db:query", { handle: this.handle, sql: sql, params: params || [] }))
      .then(function (r) { return r.rows; });
  };
  Connection.prototype.get = function (sql, params) {
    return unwrap(window.butter.invoke("db:get", { handle: this.handle, sql: sql, params: params || [] }))
      .then(function (r) { return r.row; });
  };
  Connection.prototype.close = function () {
    return unwrap(window.butter.invoke("db:close", { handle: this.handle }));
  };
  window.butter.db = {
    open: function (name, opts) {
      var readonly = opts && opts.readonly ? true : false;
      return unwrap(window.butter.invoke("db:open", { name: name, readonly: readonly }))
        .then(function (r) { return new Connection(r.handle); });
    }
  };
})();
`;

const database: Plugin = {
  name: "database",
  host,
  webview,
};

export default database;
