import type { Config } from "../types"

export const defaultConfig = (): Config => ({
  window: { title: "Butter App", width: 800, height: 600 },
  build: { entry: "src/app/index.html", host: "src/host/index.ts" },
})

export const parseConfig = (yaml: string): Config => {
  const raw = Bun.YAML.parse(yaml) ?? {}
  const defaults = defaultConfig()

  return {
    window: {
      title: raw.window?.title ?? defaults.window.title,
      width: raw.window?.width ?? defaults.window.width,
      height: raw.window?.height ?? defaults.window.height,
      icon: raw.window?.icon ?? undefined,
      resizable: typeof raw.window?.resizable === "boolean" ? raw.window.resizable : undefined,
      frameless: typeof raw.window?.frameless === "boolean" ? raw.window.frameless : undefined,
      transparent: typeof raw.window?.transparent === "boolean" ? raw.window.transparent : undefined,
      alwaysOnTop: typeof raw.window?.alwaysOnTop === "boolean" ? raw.window.alwaysOnTop : undefined,
      fullscreen: typeof raw.window?.fullscreen === "boolean" ? raw.window.fullscreen : undefined,
      material:
        raw.window?.material === "vibrancy" ||
        raw.window?.material === "mica" ||
        raw.window?.material === "acrylic" ||
        raw.window?.material === "tabbed" ||
        raw.window?.material === "none"
          ? raw.window.material
          : undefined,
    },
    build: {
      entry: raw.build?.entry ?? defaults.build.entry,
      host: raw.build?.host ?? defaults.build.host,
    },
    bundle: raw.bundle
      ? {
          identifier: raw.bundle.identifier ?? undefined,
          category: raw.bundle.category ?? undefined,
          urlSchemes: Array.isArray(raw.bundle.urlSchemes) ? raw.bundle.urlSchemes : undefined,
          usageDescriptions:
            raw.bundle.usageDescriptions && typeof raw.bundle.usageDescriptions === "object"
              ? raw.bundle.usageDescriptions
              : undefined,
          minimumSystemVersion: raw.bundle.minimumSystemVersion ?? undefined,
          sidecars: Array.isArray(raw.bundle.sidecars)
            ? raw.bundle.sidecars.filter((s: unknown) => typeof s === "string")
            : undefined,
        }
      : undefined,
    plugins: raw.plugins ?? undefined,
    security: raw.security
      ? {
          csp: raw.security.csp ?? undefined,
          allowlist: Array.isArray(raw.security.allowlist) ? raw.security.allowlist : undefined,
          capabilities: Array.isArray(raw.security.capabilities)
            ? raw.security.capabilities
                .map((c: unknown) => {
                  if (!c || typeof c !== "object") return null
                  const obj = c as Record<string, unknown>
                  if (typeof obj.name !== "string" || !Array.isArray(obj.actions)) return null
                  return {
                    name: obj.name,
                    actions: obj.actions.filter((a: unknown) => typeof a === "string"),
                    origins: Array.isArray(obj.origins)
                      ? obj.origins.filter((o: unknown) => typeof o === "string")
                      : undefined,
                  }
                })
                .filter((c: unknown): c is { name: string; actions: string[]; origins?: string[] } => c !== null)
            : undefined,
        }
      : undefined,
    splash: raw.splash ?? undefined,
    dev: raw.dev?.mcp
      ? {
          mcp: {
            enabled: raw.dev.mcp.enabled ?? undefined,
            port: raw.dev.mcp.port ?? undefined,
            consoleBuffer: raw.dev.mcp.consoleBuffer ?? undefined,
          },
        }
      : undefined,
    native:
      raw.native && typeof raw.native === "object"
        ? Object.fromEntries(
            Object.entries(raw.native as Record<string, unknown>).map(([k, v]) => {
              if (!v || typeof v !== "object") return [k, {}]
              const m = v as Record<string, unknown>
              return [
                k,
                {
                  frameworks: Array.isArray(m.frameworks) ? m.frameworks : undefined,
                  libs: Array.isArray(m.libs) ? m.libs : undefined,
                  includes: Array.isArray(m.includes) ? m.includes : undefined,
                  libDirs: Array.isArray(m.libDirs) ? m.libDirs : undefined,
                  extraFlags: Array.isArray(m.extraFlags) ? m.extraFlags : undefined,
                },
              ]
            }),
          )
        : undefined,
  }
}

export const loadConfig = async (dir: string): Promise<Config> => {
  const file = Bun.file(`${dir}/butter.yaml`)
  if (!(await file.exists())) return defaultConfig()
  const text = await file.text()
  return parseConfig(text)
}
