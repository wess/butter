import type { Plugin, HostContext } from "../../types"
import { homedir, platform } from "os"
import { join } from "path"
import { existsSync, mkdirSync } from "fs"

// JSON-file-backed persistent KV store, scoped per app. Writes are atomic
// (write to tmp, rename) and debounced so a tight loop of webview sets
// doesn't fsync on every call.

type SetParams = { name?: string; key: string; value: unknown }
type GetParams = { name?: string; key: string }
type DeleteParams = { name?: string; key: string }
type ClearParams = { name?: string }

const SAFE = /^[a-zA-Z0-9._-]+$/

const appId = (): string =>
  (process.env.BUTTER_APP_ID || process.env.BUTTER_TITLE || "butterapp").replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  )

const dataDir = (): string => {
  const id = appId()
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", id)
  if (platform() === "win32")
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), id)
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), id)
}

const storePath = (name: string): string => {
  if (!SAFE.test(name)) throw new Error(`store name must match [a-zA-Z0-9._-]: ${name}`)
  const dir = join(dataDir(), "store")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, `${name}.json`)
}

type Cache = { data: Record<string, unknown>; dirty: boolean; flushTimer?: ReturnType<typeof setTimeout> }
const caches = new Map<string, Cache>()

const loadStore = async (name: string): Promise<Cache> => {
  const cached = caches.get(name)
  if (cached) return cached
  const file = Bun.file(storePath(name))
  let data: Record<string, unknown> = {}
  if (await file.exists()) {
    try {
      data = JSON.parse(await file.text()) as Record<string, unknown>
    } catch { /* corrupt — start fresh */ }
  }
  const c: Cache = { data, dirty: false }
  caches.set(name, c)
  return c
}

const scheduleFlush = (name: string, c: Cache): void => {
  if (!c.dirty) return
  if (c.flushTimer) return
  c.flushTimer = setTimeout(async () => {
    c.flushTimer = undefined
    if (!c.dirty) return
    c.dirty = false
    const path = storePath(name)
    const tmp = `${path}.tmp`
    await Bun.write(tmp, JSON.stringify(c.data))
    const { renameSync } = await import("fs")
    renameSync(tmp, path)
  }, 100)
  c.flushTimer?.unref?.()
}

const host = (ctx: HostContext): void => {
  const flushAll = async () => {
    for (const [name, c] of caches) {
      if (!c.dirty) continue
      if (c.flushTimer) { clearTimeout(c.flushTimer); c.flushTimer = undefined }
      c.dirty = false
      const path = storePath(name)
      const tmp = `${path}.tmp`
      await Bun.write(tmp, JSON.stringify(c.data))
      const { renameSync } = await import("fs")
      renameSync(tmp, path)
    }
  }
  process.on("beforeExit", () => { flushAll().catch(() => {}) })
  process.on("SIGINT", () => { flushAll().catch(() => {}).finally(() => process.exit(0)) })
  process.on("SIGTERM", () => { flushAll().catch(() => {}).finally(() => process.exit(0)) })

  ctx.on("store:get", async (data: unknown) => {
    const { name, key } = data as GetParams
    const c = await loadStore(name ?? "default")
    return { ok: true, value: c.data[key] ?? null }
  })

  ctx.on("store:set", async (data: unknown) => {
    const { name, key, value } = data as SetParams
    const c = await loadStore(name ?? "default")
    c.data[key] = value
    c.dirty = true
    scheduleFlush(name ?? "default", c)
    return { ok: true }
  })

  ctx.on("store:delete", async (data: unknown) => {
    const { name, key } = data as DeleteParams
    const c = await loadStore(name ?? "default")
    delete c.data[key]
    c.dirty = true
    scheduleFlush(name ?? "default", c)
    return { ok: true }
  })

  ctx.on("store:keys", async (data: unknown) => {
    const { name } = (data ?? {}) as ClearParams
    const c = await loadStore(name ?? "default")
    return { ok: true, keys: Object.keys(c.data) }
  })

  ctx.on("store:clear", async (data: unknown) => {
    const { name } = (data ?? {}) as ClearParams
    const c = await loadStore(name ?? "default")
    c.data = {}
    c.dirty = true
    scheduleFlush(name ?? "default", c)
    return { ok: true }
  })

  ctx.on("store:flush", async () => {
    await flushAll()
    return { ok: true }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  function unwrap(p) { return p.then(function (r) { if (!r || !r.ok) throw new Error((r && r.error) || "store error"); return r; }); }
  function Store(name) { this.name = name; }
  Store.prototype.get = function (key) {
    return unwrap(window.butter.invoke("store:get", { name: this.name, key: key })).then(function (r) { return r.value; });
  };
  Store.prototype.set = function (key, value) {
    return unwrap(window.butter.invoke("store:set", { name: this.name, key: key, value: value }));
  };
  Store.prototype.delete = function (key) {
    return unwrap(window.butter.invoke("store:delete", { name: this.name, key: key }));
  };
  Store.prototype.keys = function () {
    return unwrap(window.butter.invoke("store:keys", { name: this.name })).then(function (r) { return r.keys; });
  };
  Store.prototype.clear = function () {
    return unwrap(window.butter.invoke("store:clear", { name: this.name }));
  };
  Store.prototype.flush = function () { return unwrap(window.butter.invoke("store:flush")); };
  window.butter.store = function (name) { return new Store(name || "default"); };
})();
`

const store: Plugin = {
  name: "store",
  host,
  webview,
}

export default store
