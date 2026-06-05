import type { Config } from "../types";

export const defaultConfig = (): Config => ({
  window: { title: "Butter App", width: 800, height: 600 },
  build: { entry: "src/app/index.html", host: "src/host/index.ts" },
});

// Replace `{VAR}` placeholders inside string values with `process.env.VAR`.
// Pattern only matches SHOUTY_SNAKE_CASE names so JSON-style braces in user
// strings (e.g. CSS values, glob patterns) are left alone. Missing vars
// resolve to an empty string so downstream code can treat absence uniformly
// (e.g. "notarize only when all creds set").
const ENV_PLACEHOLDER = /\{([A-Z_][A-Z0-9_]*)\}/g;
export const interpolateEnv = <T>(
  value: T,
  env: Record<string, string | undefined> = process.env,
): T => {
  if (typeof value === "string") {
    return value.replace(ENV_PLACEHOLDER, (_, name) => env[name] ?? "") as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateEnv(v, env)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolateEnv(v, env);
    }
    return out as T;
  }
  return value;
};

export const parseConfig = (
  yaml: string,
  env: Record<string, string | undefined> = process.env,
): Config => {
  const parsed = Bun.YAML.parse(yaml) ?? {};
  const raw = interpolateEnv(parsed as Record<string, unknown>, env) as any;
  const defaults = defaultConfig();

  return {
    window: {
      title: raw.window?.title ?? defaults.window.title,
      width: raw.window?.width ?? defaults.window.width,
      height: raw.window?.height ?? defaults.window.height,
      icon: raw.window?.icon ?? undefined,
      resizable: typeof raw.window?.resizable === "boolean" ? raw.window.resizable : undefined,
      frameless: typeof raw.window?.frameless === "boolean" ? raw.window.frameless : undefined,
      transparent:
        typeof raw.window?.transparent === "boolean" ? raw.window.transparent : undefined,
      alwaysOnTop:
        typeof raw.window?.alwaysOnTop === "boolean" ? raw.window.alwaysOnTop : undefined,
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
          macos:
            raw.bundle.macos && typeof raw.bundle.macos === "object"
              ? {
                  signingIdentity: emptyToUndef(raw.bundle.macos.signingIdentity),
                  entitlements: emptyToUndef(raw.bundle.macos.entitlements),
                  hardenedRuntime:
                    typeof raw.bundle.macos.hardenedRuntime === "boolean"
                      ? raw.bundle.macos.hardenedRuntime
                      : undefined,
                  notarize:
                    typeof raw.bundle.macos.notarize === "boolean"
                      ? raw.bundle.macos.notarize
                      : undefined,
                  appleId: emptyToUndef(raw.bundle.macos.appleId),
                  teamId: emptyToUndef(raw.bundle.macos.teamId),
                  appleIdPassword: emptyToUndef(raw.bundle.macos.appleIdPassword),
                  allowJit:
                    typeof raw.bundle.macos.allowJit === "boolean"
                      ? raw.bundle.macos.allowJit
                      : undefined,
                  dmg:
                    raw.bundle.macos.dmg && typeof raw.bundle.macos.dmg === "object"
                      ? {
                          volumeName: emptyToUndef(raw.bundle.macos.dmg.volumeName),
                          windowSize:
                            Array.isArray(raw.bundle.macos.dmg.windowSize) &&
                            raw.bundle.macos.dmg.windowSize.length === 2
                              ? (raw.bundle.macos.dmg.windowSize as [number, number])
                              : undefined,
                        }
                      : undefined,
                }
              : undefined,
          windows:
            raw.bundle.windows && typeof raw.bundle.windows === "object"
              ? {
                  pfx: emptyToUndef(raw.bundle.windows.pfx),
                  pfxPassword: emptyToUndef(raw.bundle.windows.pfxPassword),
                }
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
                  if (!c || typeof c !== "object") {
                    return null;
                  }
                  const obj = c as Record<string, unknown>;
                  if (typeof obj.name !== "string" || !Array.isArray(obj.actions)) {
                    return null;
                  }
                  return {
                    name: obj.name,
                    actions: obj.actions.filter((a: unknown) => typeof a === "string"),
                    origins: Array.isArray(obj.origins)
                      ? obj.origins.filter((o: unknown) => typeof o === "string")
                      : undefined,
                  };
                })
                .filter(
                  (c: unknown): c is { name: string; actions: string[]; origins?: string[] } =>
                    c !== null,
                )
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
              if (!v || typeof v !== "object") {
                return [k, {}];
              }
              const m = v as Record<string, unknown>;
              return [
                k,
                {
                  frameworks: Array.isArray(m.frameworks) ? m.frameworks : undefined,
                  libs: Array.isArray(m.libs) ? m.libs : undefined,
                  includes: Array.isArray(m.includes) ? m.includes : undefined,
                  libDirs: Array.isArray(m.libDirs) ? m.libDirs : undefined,
                  extraFlags: Array.isArray(m.extraFlags) ? m.extraFlags : undefined,
                },
              ];
            }),
          )
        : undefined,
  };
};

// Env-var placeholders that resolve to missing vars become empty strings.
// Treat empty as "field not set" so the conditional sign/notarize logic
// downstream stays simple ("if signingIdentity is set, use it").
const emptyToUndef = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

export const loadConfig = async (dir: string): Promise<Config> => {
  const file = Bun.file(`${dir}/butter.yaml`);
  if (!(await file.exists())) {
    return defaultConfig();
  }
  const text = await file.text();
  return parseConfig(text);
};
