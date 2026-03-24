# Types Reference

All types are defined in `src/types/index.ts` and re-exported from the `"butter"` package.

---

## `Config`

The top-level project configuration object, produced by `loadConfig()` and `parseConfig()`.

```ts
type Config = {
  window: WindowOptions
  build: BuildOptions
  plugins?: string[]
}
```

| Field | Type | Description |
|---|---|---|
| `window` | `WindowOptions` | Initial window dimensions and title. |
| `build` | `BuildOptions` | Entry points for the webview and host. |
| `plugins` | `string[]` (optional) | Plugin module paths or package names. |

---

## `WindowOptions`

Describes the initial state of the native window.

```ts
type WindowOptions = {
  title: string
  width: number
  height: number
}
```

| Field | Type | Description |
|---|---|---|
| `title` | `string` | Window title and process name. |
| `width` | `number` | Initial window width in pixels. |
| `height` | `number` | Initial window height in pixels. |

Used by:
- `getWindow()` — returns a copy of the current window state.
- `setWindow(opts: Partial<WindowOptions>)` — merges partial updates.
- `createRuntime(initialWindow?: Partial<WindowOptions>)` — sets the initial state.

---

## `BuildOptions`

Specifies the source files Butter processes at dev/compile time.

```ts
type BuildOptions = {
  entry: string
  host: string
}
```

| Field | Type | Description |
|---|---|---|
| `entry` | `string` | Relative path to the HTML entry point for Bun's bundler. |
| `host` | `string` | Relative path to the host TypeScript entry point. |

---

## `MenuItem`

A discriminated union representing a single item in a menu section. Either a clickable item or a visual separator.

```ts
type MenuItem =
  | { label: string; action: string; shortcut?: string }
  | { separator: true }
```

**Clickable item fields**

| Field | Type | Description |
|---|---|---|
| `label` | `string` | Display text for the menu item. |
| `action` | `string` | Action identifier dispatched over IPC when the item is clicked. Use well-known action strings (see below) to map to native selectors. |
| `shortcut` | `string` (optional) | Keyboard shortcut string, e.g. `"CmdOrCtrl+Q"`. `CmdOrCtrl` resolves to `Cmd` on macOS and `Ctrl` on Linux. |

**Separator**

| Field | Type | Description |
|---|---|---|
| `separator` | `true` | Renders a visual divider. No other fields are valid. |

**Well-known action strings**

These action strings map directly to native selectors on macOS and do not route through IPC:

| Action string | Native selector |
|---|---|
| `edit:undo` | `undo:` |
| `edit:redo` | `redo:` |
| `edit:cut` | `cut:` |
| `edit:copy` | `copy:` |
| `edit:paste` | `paste:` |
| `edit:selectall` | `selectAll:` |
| `app:quit` | Filtered out (handled by the app menu) |

Any other action string routes through IPC and triggers `on(action, handler)` in host code.

---

## `MenuSection`

A labeled group of menu items, rendered as a top-level menu in the native menu bar.

```ts
type MenuSection = {
  label: string
  items: MenuItem[]
}
```

| Field | Type | Description |
|---|---|---|
| `label` | `string` | The top-level menu title (e.g. `"File"`, `"Edit"`). |
| `items` | `MenuItem[]` | Ordered list of items in the dropdown. |

---

## `Menu`

An ordered array of `MenuSection` objects. Exported as the default from `src/host/menu.ts`.

```ts
type Menu = MenuSection[]
```

**Example**

```ts
import type { Menu } from "butter"

const menu: Menu = [
  {
    label: "File",
    items: [
      { label: "Quit", action: "app:quit", shortcut: "CmdOrCtrl+Q" },
    ],
  },
  {
    label: "Edit",
    items: [
      { label: "Undo", action: "edit:undo", shortcut: "CmdOrCtrl+Z" },
      { label: "Redo", action: "edit:redo", shortcut: "CmdOrCtrl+Shift+Z" },
      { separator: true },
      { label: "Cut", action: "edit:cut", shortcut: "CmdOrCtrl+X" },
      { label: "Copy", action: "edit:copy", shortcut: "CmdOrCtrl+C" },
      { label: "Paste", action: "edit:paste", shortcut: "CmdOrCtrl+V" },
    ],
  },
]

export default menu
```

---

## `HostContext`

The context object passed to a plugin's `host` function. Provides the same `on`/`send` interface as the top-level host API.

```ts
type HostContext = {
  on: (action: string, handler: (data: unknown) => unknown) => void
  send: (action: string, data: unknown) => void
}
```

| Field | Type | Description |
|---|---|---|
| `on` | function | Register a handler for an IPC action. |
| `send` | function | Push an event to the webview. |

---

## `Plugin`

The interface a Butter plugin module must satisfy.

```ts
type Plugin = {
  name: string
  host: (ctx: HostContext) => void
  webview: () => string
}
```

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Human-readable plugin identifier. |
| `host` | `(ctx: HostContext) => void` | Called during host initialization. Register IPC handlers here. |
| `webview` | `() => string` | Returns a JavaScript string that will be injected into the webview. |

---

## `IpcMessage`

The wire format for all messages exchanged between the host and the shim. Serialized as JSON and framed in the ring buffer with a 4-byte little-endian length prefix.

```ts
type IpcMessage = {
  id: string
  type: "invoke" | "response" | "event" | "control"
  action: string
  data?: unknown
  error?: string
}
```

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Monotonically incrementing integer, stringified. Correlates `invoke` with its `response`. |
| `type` | union | Message category (see below). |
| `action` | `string` | The action or control command name. |
| `data` | `unknown` (optional) | JSON-serializable payload. |
| `error` | `string` (optional) | Present on `response` messages when the host handler threw. |

**Message types**

| Type | Direction | Description |
|---|---|---|
| `invoke` | webview → host | Webview requests a host handler. Expects a `response`. |
| `response` | host → webview | Host returns the result of an `invoke`. `id` matches the original. |
| `event` | both directions | Fire-and-forget notification. No response expected. |
| `control` | both directions | Internal lifecycle signals: `quit`, `reload`. |

---

## Internal Types

These types are not exported from the `"butter"` package but are used internally.

### `Runtime` (internal)

```ts
type Runtime = {
  on: (action: string, handler: Handler) => void
  send: (action: string, data?: unknown) => void
  dispatch: (action: string, data: unknown) => unknown
  getWindow: () => WindowOptions
  setWindow: (opts: Partial<WindowOptions>) => void
  drainOutgoing: () => IpcMessage[]
}
```

Created by `createRuntime(initialWindow?)` and stored on `globalThis.__butterRuntime`. The exported `on`, `send`, `getWindow`, and `setWindow` functions delegate to this instance.

### `SharedRegion` (internal)

```ts
type SharedRegion = {
  name: string
  buffer: Uint8Array
  pointer: number
  size: number
  semToBun: number
  semToShim: number
}
```

Holds references to the mapped shared memory buffer and both POSIX semaphore handles. Used by `src/ipc/shmem.ts`.
