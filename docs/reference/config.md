# Configuration Reference

Butter reads project configuration from `butter.yaml` in the project root. All fields are optional; the file itself is optional. If `butter.yaml` is absent, all defaults apply.

Configuration is parsed by `src/config/index.ts` using `Bun.YAML.parse`.

---

## Full Schema

```yaml
window:
  title: string             # default: "Butter App"
  width: number             # default: 800
  height: number            # default: 600
  icon: string              # default: undefined
  resizable: boolean        # default: true
  frameless: boolean        # default: false
  transparent: boolean      # default: false
  alwaysOnTop: boolean      # default: false
  fullscreen: boolean       # default: false
  material: string          # default: undefined  (vibrancy | mica | acrylic | tabbed | none)

build:
  entry: string             # default: "src/app/index.html"
  host: string              # default: "src/host/index.ts"

bundle:
  identifier: string        # default: undefined
  category: string          # default: undefined
  urlSchemes:               # default: undefined
    - string
  sidecars:                 # default: undefined  (paths relative to project root)
    - string

security:
  csp: string               # default: undefined
  allowlist:                # default: undefined (allow all)
    - string
  capabilities:             # default: undefined  (groups of actions)
    - name: string
      actions: [string]
      origins: [string]     # optional, butter:// origins

splash: string              # default: undefined

plugins:                    # optional
  - string
```

---

## `window`

Controls the initial state of the native window.

### `window.title`

| | |
|---|---|
| Type | `string` |
| Default | `"Butter App"` |

The window title, shown in the title bar and in the macOS Dock and menu bar. Also used as the process name on macOS (via `NSProcessInfo.processName`) so that the native menu bar displays the correct app name.

During `compile`, the title is lowercased and stripped of non-alphanumeric characters to produce the output binary filename.

```yaml
window:
  title: "My App"
```

### `window.width`

| | |
|---|---|
| Type | `number` |
| Default | `800` |
| Unit | pixels |

Initial window width. The window is resizable; this is only the starting size.

```yaml
window:
  width: 1280
```

### `window.height`

| | |
|---|---|
| Type | `number` |
| Default | `600` |
| Unit | pixels |

Initial window height.

```yaml
window:
  height: 720
```

### `window.material`

| | |
|---|---|
| Type | `"vibrancy" \| "mica" \| "acrylic" \| "tabbed" \| "none"` |
| Default | `undefined` |

Applies a translucent system material to the window background. The webview's background is set transparent so the material shows through — make sure your CSS doesn't paint an opaque `body { background: ... }` or the effect won't be visible.

| Value | macOS | Windows 11 | Linux |
|---|---|---|---|
| `vibrancy` | `NSVisualEffectView` (sidebar material) | no-op | no-op |
| `mica` | `NSVisualEffectView` (sidebar material) | `DWMWA_SYSTEMBACKDROP_TYPE = 2` | no-op |
| `acrylic` | `NSVisualEffectView` (sidebar material) | `DWMWA_SYSTEMBACKDROP_TYPE = 3` | no-op |
| `tabbed` | `NSVisualEffectView` (sidebar material) | `DWMWA_SYSTEMBACKDROP_TYPE = 4` | no-op |
| `none` | regular opaque window | regular opaque window | regular opaque window |

```yaml
window:
  material: vibrancy
```

---

## `build`

Controls which source files are compiled and executed.

### `build.entry`

| | |
|---|---|
| Type | `string` |
| Default | `"src/app/index.html"` |

Path to the HTML entry point for the webview, relative to the project root. Bun's bundler uses this file as the entry point. Scripts referenced via `<script src="...">` and stylesheets referenced via `<link href="...">` are bundled and then inlined into the HTML before being passed to the WebView.

```yaml
build:
  entry: src/app/index.html
```

### `build.host`

| | |
|---|---|
| Type | `string` |
| Default | `"src/host/index.ts"` |

Path to the host entry point, relative to the project root. This module is imported by the CLI after the runtime is initialized. It should call `on()` and optionally `send()` to set up the application's IPC surface.

```yaml
build:
  host: src/host/index.ts
```

---

## `bundle`

Controls OS-native app packaging produced by `butter bundle`.

### `bundle.identifier`

| | |
|---|---|
| Type | `string` |
| Default | `undefined` |

The application identifier used for the app bundle. On macOS this becomes the `CFBundleIdentifier` in `Info.plist`.

```yaml
bundle:
  identifier: com.example.myapp
```

### `bundle.category`

| | |
|---|---|
| Type | `string` |
| Default | `undefined` |

The macOS application category. Used as `LSApplicationCategoryType` in `Info.plist`.

```yaml
bundle:
  category: public.app-category.utilities
```

### `bundle.urlSchemes`

| | |
|---|---|
| Type | `string[]` |
| Default | `undefined` |

Custom URL schemes for deep linking. Registers the app as a handler for the given schemes so that URLs like `myapp://path` open the application.

```yaml
bundle:
  urlSchemes:
    - myapp
```

### `bundle.sidecars`

| | |
|---|---|
| Type | `string[]` |
| Default | `undefined` |

External executables to ship alongside the main binary (ffmpeg, yt-dlp, a Go daemon, etc.). Paths are resolved relative to the project root.

During `butter bundle`, each entry is copied (preserving the executable bit on POSIX) into:

| Platform | Destination |
|---|---|
| macOS | `<App>.app/Contents/MacOS/sidecars/` |
| Linux | `<App>.AppDir/usr/bin/sidecars/` |
| Windows | `<App>/sidecars/` |

The `sidecar` plugin discovers them by basename (without the `.exe` suffix on Windows).

```yaml
bundle:
  sidecars:
    - bin/ffmpeg
    - bin/yt-dlp
```

```ts
const ffmpeg = await butter.sidecar.spawn("ffmpeg", { args: ["-version"] })
ffmpeg.onStdout((d) => console.log(d.data))
ffmpeg.onExit((d) => console.log("exit", d.code))
```

---

## `security`

Controls webview security policies.

### `security.csp`

| | |
|---|---|
| Type | `string` |
| Default | `undefined` |

A Content-Security-Policy header applied to the webview. Use this to restrict which resources the webview can load.

```yaml
security:
  csp: "default-src 'self' butter:"
```

### `security.allowlist`

| | |
|---|---|
| Type | `string[]` |
| Default | `undefined` (allow all) |

Restricts which IPC actions the webview is permitted to call. Supports exact matches, namespace wildcards, and a global wildcard.

```yaml
security:
  allowlist:
    - "dialog:*"    # Namespace wildcard
    - "greet"       # Exact match
    - "*"           # Allow all (default when omitted)
```

### `security.capabilities`

| | |
|---|---|
| Type | `Capability[]` where `Capability = { name: string, actions: string[], origins?: string[] }` |
| Default | `undefined` |

A capability groups related IPC actions under a single named grant. The webview may invoke an action if *any* capability grants it (the union of all capabilities plus `allowlist` applies). Use capabilities when you want explicit, reviewable bundles of permission rather than a flat list — they make intent visible at the audit boundary.

```yaml
security:
  capabilities:
    - name: filesystem
      actions: ["fs:*", "dialog:open", "dialog:save"]
    - name: storage
      actions: ["store:*", "db:*"]
    - name: power-monitor
      actions: ["power:idle", "screen:list"]
```

When both `allowlist` and `capabilities` are defined, the union grants access. When neither is defined, all actions are allowed (no policy).

The `origins` field is reserved for future per-origin scoping (e.g. limiting an action to `butter://app/` vs `butter://settings/`); it currently parses but is not enforced.

---

## `splash`

| | |
|---|---|
| Type | `string` |
| Default | `undefined` |

Path to an HTML file shown while the app loads, relative to the project root. The splash screen is displayed immediately when the window opens and is swapped out for the main entry point once `ready()` is called.

```yaml
splash: src/app/splash.html
```

---

## `plugins`

| | |
|---|---|
| Type | `string[]` |
| Default | `undefined` (no plugins) |

A list of plugin module paths or package names. Butter imports each plugin module at startup, calls `host()` to register IPC handlers, and injects the `webview()` string into the webview before the page loads. Plugins are loaded in the order listed.

```yaml
plugins:
  - ./plugins/analytics.ts
  - butter-plugin-autoupdate
```

---

## Defaults

The following object is returned when `butter.yaml` is absent or a field is omitted:

```ts
{
  window: {
    title: "Butter App",
    width: 800,
    height: 600,
  },
  build: {
    entry: "src/app/index.html",
    host: "src/host/index.ts",
  },
  bundle: undefined,
  security: undefined,
  splash: undefined,
}
```

---

## Example

```yaml
window:
  title: "My Desktop App"
  width: 1024
  height: 768

build:
  entry: src/app/index.html
  host: src/host/index.ts

bundle:
  identifier: com.example.mydesktopapp
  category: public.app-category.utilities
  urlSchemes:
    - mydesktopapp

security:
  csp: "default-src 'self' butter:"
  allowlist:
    - "dialog:*"
    - "greet"

splash: src/app/splash.html
```

---

## Loading Order

1. `loadConfig(dir)` checks for `<dir>/butter.yaml`.
2. If the file does not exist, `defaultConfig()` is returned immediately.
3. If the file exists, its text is passed to `parseConfig(yaml)`.
4. Each field is merged with defaults: `raw.field ?? default.field`.
5. The resulting `Config` object is used for the rest of the command's lifetime.
