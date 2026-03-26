# API Reference

Butter exposes two distinct API surfaces: the **host API** (runs in Bun, imported from `"butter"`) and the **webview API** (runs in the browser context, available on `window.butter`).

---

## Host API

Import from the `"butter"` package inside `src/host/index.ts`.

```ts
import { on, send, getWindow, setWindow } from "butter"
```

The host API is backed by a `Runtime` instance that the CLI creates before importing host code. All functions delegate to a global `__butterRuntime` singleton. Calling any host function before the runtime is initialized throws an error.

---

### `on(action, handler)`

Registers a handler for an IPC action. When the webview calls `butter.invoke(action, data)`, the host dispatches to the matching handler and sends the return value back as a response.

```ts
on(action: string, handler: (data: unknown) => unknown): void
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `action` | `string` | The action name. Must match what the webview passes to `butter.invoke()`. |
| `handler` | `(data: unknown) => unknown` | Called with the data sent by the webview. May return a value or a `Promise`. The resolved value is sent back as the response. |

**Notes**

- Only one handler per action name is retained. Registering a second handler for the same action replaces the first.
- If the handler throws synchronously, the error message is sent back to the webview and the `Promise` returned by `butter.invoke()` rejects.
- If the handler returns a `Promise` that rejects, the rejection reason is forwarded to the webview.
- Menu actions dispatched from the native menu bar also route through `on()`. Their `data` argument is `undefined`.

**Example**

```ts
import { on } from "butter"

on("greet", (name) => {
  return `Hello, ${name}!`
})

on("read-file", async (path) => {
  const file = Bun.file(path as string)
  return file.text()
})

on("quit", () => {
  process.exit(0)
})
```

---

### `send(action, data?)`

Pushes an event to the webview. The event is queued in the outgoing buffer and flushed on the next poll tick (~16 ms). Handlers registered with `butter.on(action, handler)` in the webview will be called.

```ts
send(action: string, data?: unknown): void
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `action` | `string` | Arbitrary event name. Must match what the webview registers with `butter.on()`. |
| `data` | `unknown` | Optional payload. Must be JSON-serializable. |

**Notes**

- `send()` is fire-and-forget. There is no acknowledgement from the webview.
- Messages are serialized as `IpcMessage` objects with `type: "event"`.
- If the ring buffer is full when the poll loop flushes, the message is dropped silently. Under normal usage the buffer (roughly 32 KB per direction) is not a bottleneck.

**Example**

```ts
import { send } from "butter"

// Push a notification to the webview
send("notification", { title: "Done", body: "Export complete." })

// Push without data
send("theme-changed")
```

---

### `getWindow()`

Returns a snapshot of the current window state.

```ts
getWindow(): WindowOptions
```

**Returns**

A `WindowOptions` object (see the types reference for the full list of fields). The returned object is a shallow copy; mutating it has no effect.

**Example**

```ts
import { getWindow } from "butter"

on("window-info", () => {
  return getWindow()
})
```

---

### `setWindow(opts)`

Updates the window state and sends a `window:set` control message to the shim so the native window reflects the change immediately (resize, retitle, reposition, etc.).

```ts
setWindow(opts: Partial<WindowOptions>): Promise<unknown>
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `opts` | `Partial<WindowOptions>` | One or more window properties to update. Unspecified properties retain their current values. |

**Example**

```ts
import { setWindow, getWindow } from "butter"

on("rename", (title) => {
  setWindow({ title: title as string })
  return getWindow()
})
```

---

## Window Control

These functions send control messages to the native shim and return a `Promise` that resolves when the shim acknowledges the command.

```ts
import { maximize, minimize, restore, fullscreen, setAlwaysOnTop, closeWindow } from "butter"
```

---

### `maximize()`

Maximizes the main window to fill the screen.

```ts
maximize(): Promise<unknown>
```

---

### `minimize()`

Minimizes the main window to the dock/taskbar.

```ts
minimize(): Promise<unknown>
```

---

### `restore()`

Restores the window from a minimized or maximized state to its previous dimensions.

```ts
restore(): Promise<unknown>
```

---

### `fullscreen(enable)`

Toggles native fullscreen mode on the main window.

```ts
fullscreen(enable: boolean): Promise<unknown>
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `enable` | `boolean` | `true` to enter fullscreen, `false` to exit. |

---

### `setAlwaysOnTop(enable)`

Sets whether the window floats above all other windows.

```ts
setAlwaysOnTop(enable: boolean): Promise<unknown>
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `enable` | `boolean` | `true` to pin the window on top, `false` to restore normal z-order. |

---

### `closeWindow(windowId?)`

Closes a window by its ID. When called without an argument, closes the main window.

```ts
closeWindow(windowId?: string): Promise<unknown>
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `windowId` | `string` (optional) | The ID returned by `createWindow()`. Omit to close the main window. |

---

## Multi-Window

```ts
import { createWindow } from "butter"
```

---

### `createWindow(opts)`

Creates a new native window and returns its unique identifier. The new window loads the URL specified in `opts.url`.

```ts
createWindow(opts: CreateWindowOptions): string
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `opts` | `CreateWindowOptions` | Configuration for the new window. |

**`CreateWindowOptions`**

| Field | Type | Description |
|---|---|---|
| `url` | `string` | The URL or file path to load in the new window. |
| `title` | `string` (optional) | Window title. |
| `width` | `number` (optional) | Initial width in pixels. |
| `height` | `number` (optional) | Initial height in pixels. |
| `x` | `number` (optional) | Horizontal position in screen coordinates. |
| `y` | `number` (optional) | Vertical position in screen coordinates. |
| `frameless` | `boolean` (optional) | Remove the native title bar and frame. |
| `transparent` | `boolean` (optional) | Allow the window background to be transparent. |
| `alwaysOnTop` | `boolean` (optional) | Float the window above all others. |
| `modal` | `boolean` (optional) | Open as a modal window attached to the main window. |

**Returns**

A `string` window ID. Pass this to `closeWindow()` to close the window later.

**Example**

```ts
import { createWindow, closeWindow } from "butter"

const settingsId = createWindow({
  url: "settings.html",
  title: "Settings",
  width: 480,
  height: 360,
  modal: true,
})

on("close-settings", () => {
  closeWindow(settingsId)
})
```

---

## Content

```ts
import { setMenu, print, screenshot, ready, listScreens, sendChunk } from "butter"
```

---

### `setMenu(menu)`

Replaces the application menu bar at runtime. The `menu` argument uses the same `Menu` type described in the types reference.

```ts
setMenu(menu: unknown): Promise<unknown>
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `menu` | `Menu` | The new menu structure. |

---

### `print()`

Opens the native print dialog for the current webview content.

```ts
print(): Promise<unknown>
```

---

### `screenshot(path)`

Captures the webview content and writes it to a PNG file at the given path.

```ts
screenshot(path: string): Promise<unknown>
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `path` | `string` | Absolute file path where the PNG will be saved. |

---

### `ready()`

Signals to the shim that the application is ready to be shown. When a splash screen is configured in `butter.yaml`, calling `ready()` swaps the splash screen for the main webview content.

```ts
ready(): Promise<unknown>
```

**Example**

```ts
import { ready } from "butter"

// After all initial data is loaded
ready()
```

---

### `listScreens()`

Returns information about all connected monitors, including their positions, sizes, and scale factors.

```ts
listScreens(): Promise<unknown>
```

**Returns**

A `Promise` resolving to an array of screen descriptor objects, each containing position, size, and `scaleFactor` fields.

---

### `sendChunk(requestId, data)`

Sends a streaming chunk to a pending webview request. Use this to stream data back to the webview incrementally rather than returning all data at once from a handler.

```ts
sendChunk(requestId: string, data: unknown): void
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `requestId` | `string` | The ID of the in-flight request to send data to. |
| `data` | `unknown` | The chunk payload. Must be JSON-serializable. |

---

## Webview API

The bridge script is injected by the shim at `WKUserScriptInjectionTimeAtDocumentStart`, before any page scripts run. It is available on `window.butter` globally.

To get TypeScript types in your webview code, add the following ambient declaration (the template generates `src/env.d.ts` with this content):

```ts
declare global {
  const butter: {
    invoke: (action: string, data?: unknown) => Promise<unknown>
    on: (action: string, handler: (data: unknown) => void) => void
  }
}
export {}
```

---

### `butter.invoke(action, data?)`

Sends an IPC message to the host and returns a Promise that resolves with the host handler's return value.

```ts
butter.invoke(action: string, data?: unknown): Promise<unknown>
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `action` | `string` | Action name. Must match a handler registered with `on()` in host code. |
| `data` | `unknown` | Optional payload. Must be JSON-serializable. |

**Returns**

A `Promise` that:
- Resolves with the value returned (or resolved) by the host handler.
- Rejects with an `Error` if the host handler throws or its Promise rejects. The error message is the string propagated from the host.

**Notes**

- Each call is assigned a unique integer ID. The host echoes this ID on the response, allowing concurrent in-flight invocations.
- If no handler is registered for the action, the host returns `undefined` and the Promise resolves with `undefined`.

**Example**

```ts
const greeting = await butter.invoke("greet", "world")
console.log(greeting) // "Hello, world!"

try {
  const result = await butter.invoke("might-fail")
} catch (err) {
  console.error(err.message)
}
```

---

### `butter.on(action, handler)`

Subscribes to events pushed by the host via `send()`.

```ts
butter.on(action: string, handler: (data: unknown) => void): void
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `action` | `string` | Event name. Must match what the host passes to `send()`. |
| `handler` | `(data: unknown) => void` | Called each time the event arrives. |

**Notes**

- Multiple handlers can be registered for the same action; all are called in registration order.
- There is no `off()` in the current API. Handlers persist for the lifetime of the page.
- The `handler` is called synchronously in the `__butterReceive` dispatch path, which is invoked by the shim's `evaluateJavaScript` call on each poll tick.

**Example**

```ts
butter.on("notification", (data) => {
  const { title, body } = data as { title: string; body: string }
  console.log(`${title}: ${body}`)
})

butter.on("theme-changed", () => {
  document.body.classList.toggle("dark")
})
```

---

## Internal Bridge

The bridge is a self-contained IIFE injected by the shim. Its full source (from `src/shim/darwin.m`) is:

```js
(function() {
  var p = new Map(), n = 1, l = new Map();

  window.__butterReceive = function(j) {
    var m = JSON.parse(j);
    if (m.type === 'response') {
      var r = p.get(m.id);
      if (r) { p.delete(m.id); if (m.error) r.reject(new Error(m.error)); else r.resolve(m.data); }
    } else if (m.type === 'event') {
      var h = l.get(m.action) || [];
      for (var i = 0; i < h.length; i++) h[i](m.data);
    }
  };

  var send = function(m) {
    window.webkit.messageHandlers.butter.postMessage(JSON.stringify(m));
  };

  window.butter = {
    invoke: function(a, d) {
      return new Promise(function(res, rej) {
        var id = String(n++);
        p.set(id, { resolve: res, reject: rej });
        send({ id: id, type: 'invoke', action: a, data: d });
      });
    },
    on: function(a, h) {
      if (!l.has(a)) l.set(a, []);
      l.get(a).push(h);
    }
  };
})();
```

`window.__butterReceive(json)` is the entry point called by the shim's poll timer when a message arrives from the host. `window.webkit.messageHandlers.butter.postMessage` is the WKWebView native bridge that delivers messages from the webview to the shim's `WKScriptMessageHandler`.
