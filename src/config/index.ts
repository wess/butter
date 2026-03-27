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
        }
      : undefined,
    plugins: raw.plugins ?? undefined,
  }
}

export const loadConfig = async (dir: string): Promise<Config> => {
  const file = Bun.file(`${dir}/butter.yaml`)
  if (!(await file.exists())) return defaultConfig()
  const text = await file.text()
  return parseConfig(text)
}
