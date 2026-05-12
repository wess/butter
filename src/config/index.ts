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
        }
      : undefined,
    plugins: raw.plugins ?? undefined,
    security: raw.security
      ? {
          csp: raw.security.csp ?? undefined,
          allowlist: Array.isArray(raw.security.allowlist) ? raw.security.allowlist : undefined,
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
