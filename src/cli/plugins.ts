import * as registry from "../plugins"
import type { Plugin, HostContext } from "../types"

type Runtime = {
  on: (action: string, handler: (data: unknown) => unknown) => void
  send: (action: string, data?: unknown) => void
}

const lookupPlugin = (name: string): Plugin | null => {
  const reg = registry as unknown as Record<string, Plugin | undefined>
  const plugin = reg[name]
  if (!plugin || typeof plugin !== "object") return null
  if (typeof plugin.host !== "function" || typeof plugin.webview !== "function") return null
  return plugin
}

// Names we've already warned about, so dev.ts/compile.ts calling
// resolvePlugins() multiple times (once for host, once for the webview
// bundle, once per file-watch rebuild) doesn't spam the console.
const warnedNames = new Set<string>()

// Resolve raw plugin entries (strings) to actual Plugin objects, logging
// warnings for unknown names but never throwing — a typo in butter.yaml
// shouldn't crash the dev server.
const resolvePlugins = (names: readonly string[] | undefined): Plugin[] => {
  if (!names || names.length === 0) return []
  const resolved: Plugin[] = []
  for (const name of names) {
    if (typeof name !== "string") {
      const repr = JSON.stringify(name)
      if (!warnedNames.has(repr)) {
        warnedNames.add(repr)
        console.warn(`Skipping non-string plugin entry: ${repr}`)
      }
      continue
    }
    const plugin = lookupPlugin(name)
    if (!plugin) {
      if (!warnedNames.has(name)) {
        warnedNames.add(name)
        console.warn(`Unknown plugin "${name}" — skipping. Check butter.yaml.`)
      }
      continue
    }
    resolved.push(plugin)
  }
  return resolved
}

// Wire up host-side handlers for each plugin. Plugin host() functions are
// synchronous registration: they call ctx.on(...) for each verb. The handlers
// themselves may be async (e.g. securestorage runs `Bun.$` shell commands) —
// that's fine because the runtime's dispatch loop already awaits Promises
// returned by handlers.
export const loadHostPlugins = (
  names: readonly string[] | undefined,
  runtime: Runtime,
): void => {
  const plugins = resolvePlugins(names)
  for (const plugin of plugins) {
    const ctx: HostContext = {
      on: (action, handler) => runtime.on(action, handler),
      send: (action, data) => runtime.send(action, data),
    }
    try {
      plugin.host(ctx)
      console.log(`Loaded plugin: ${plugin.name}`)
    } catch (err) {
      console.error(`Plugin "${plugin.name}" host() threw:`, err)
    }
  }
}

// Concatenated webview JS for all configured plugins. Wrapped with a banner
// per plugin to make debugging easier when the bundle is opened in DevTools.
export const buildWebviewBundle = (names: readonly string[] | undefined): string => {
  const plugins = resolvePlugins(names)
  if (plugins.length === 0) return ""
  const parts: string[] = []
  for (const plugin of plugins) {
    parts.push(`/* butter plugin: ${plugin.name} */`)
    try {
      parts.push(plugin.webview())
    } catch (err) {
      console.error(`Plugin "${plugin.name}" webview() threw:`, err)
    }
  }
  return parts.join("\n")
}

// Inject a <script src="./butter-plugins.js"> tag into the bundled index.html
// (immediately before the closing </head>) and write the bundle file alongside
// it. Returns true if anything was written.
export const writeWebviewBundle = async (
  buildDir: string,
  names: readonly string[] | undefined,
): Promise<boolean> => {
  const bundle = buildWebviewBundle(names)
  if (!bundle) return false

  const { join } = await import("path")
  const bundlePath = join(buildDir, "butter-plugins.js")
  await Bun.write(bundlePath, bundle)

  const htmlPath = join(buildDir, "index.html")
  const htmlFile = Bun.file(htmlPath)
  if (!(await htmlFile.exists())) return false
  const html = await htmlFile.text()
  const tag = `<script src="./butter-plugins.js"></script>`
  if (html.includes("butter-plugins.js")) return true

  // Prefer to inject before </head>; fall back to before the first <script>
  // (which is typically main.tsx in module mode). The plugin bundle is a
  // classic script, so it executes synchronously during HTML parsing and
  // therefore before any deferred module scripts.
  let injected: string
  if (html.includes("</head>")) {
    injected = html.replace("</head>", `  ${tag}\n  </head>`)
  } else {
    injected = html.replace(/<script\b/i, `${tag}\n    <script`)
  }
  await Bun.write(htmlPath, injected)
  return true
}
