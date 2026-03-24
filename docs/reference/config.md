# Configuration Reference

Butter reads project configuration from `butter.yaml` in the project root. All fields are optional; the file itself is optional. If `butter.yaml` is absent, all defaults apply.

Configuration is parsed by `src/config/index.ts` using `Bun.YAML.parse`.

---

## Full Schema

```yaml
window:
  title: string      # default: "Butter App"
  width: number      # default: 800
  height: number     # default: 600

build:
  entry: string      # default: "src/app/index.html"
  host: string       # default: "src/host/index.ts"

plugins:             # optional
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

## `plugins`

| | |
|---|---|
| Type | `string[]` |
| Default | `undefined` (no plugins) |

A list of plugin module paths or package names. Plugin support is declared in the type system but not yet implemented in the runtime. This field is parsed and stored in the `Config` object for forward compatibility.

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
```

---

## Loading Order

1. `loadConfig(dir)` checks for `<dir>/butter.yaml`.
2. If the file does not exist, `defaultConfig()` is returned immediately.
3. If the file exists, its text is passed to `parseConfig(yaml)`.
4. Each field is merged with defaults: `raw.field ?? default.field`.
5. The resulting `Config` object is used for the rest of the command's lifetime.
