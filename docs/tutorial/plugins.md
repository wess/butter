# Plugins

Plugins extend Butter with reusable capabilities — native file dialogs, system notifications, clipboard access, or anything else that needs to bridge host and webview code.

A plugin is a plain object with three fields: a name, a host function, and a webview function.

## Plugin Shape

```ts
import type { Plugin } from "butter"

const myplugin: Plugin = {
  name: "myplugin",

  // Runs in Bun. Register IPC handlers here.
  host: ({ on, send }) => {
    on("myplugin:action", (data) => {
      // Do something native
      return result
    })
  },

  // Returns a JS string injected into the webview.
  // Use this to expose a convenient API on window.butter.
  webview: () => `
    window.butter.myPlugin = {
      action: (data) => butter.invoke("myplugin:action", data)
    }
  `,
}

export default myplugin
```

The `host` function receives a `HostContext` with `on` and `send` — the same functions available from `"butter"` in your host code.

The `webview` function returns a raw JavaScript string. Butter injects it into the webview before your app code runs. Use it to attach helpers to `window.butter` or set up event listeners.

## Writing a Plugin

Here is a complete clipboard plugin:

```ts
// butter-plugin-clipboard/index.ts
import type { Plugin } from "butter"
import { execSync } from "child_process"

const clipboard: Plugin = {
  name: "clipboard",

  host: ({ on }) => {
    on("clipboard:read", () => {
      if (process.platform === "darwin") {
        return execSync("pbpaste").toString()
      }
      return execSync("xclip -selection clipboard -o").toString()
    })

    on("clipboard:write", (text) => {
      if (process.platform === "darwin") {
        const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" })
        proc.stdin.write(text as string)
        proc.stdin.end()
      } else {
        const proc = Bun.spawn(["xclip", "-selection", "clipboard"], { stdin: "pipe" })
        proc.stdin.write(text as string)
        proc.stdin.end()
      }
    })
  },

  webview: () => `
    window.butter.clipboard = {
      read: () => butter.invoke("clipboard:read"),
      write: (text) => butter.invoke("clipboard:write", text),
    }
  `,
}

export default clipboard
```

## Registering Plugins

Plugins are listed in `butter.yaml` by their package name or local path:

```yaml
window:
  title: My App
  width: 800
  height: 600

build:
  entry: src/app/index.html
  host: src/host/index.ts

plugins:
  - butter-plugin-clipboard
  - ./plugins/myplugin
```

Butter imports each plugin module at startup, calls `host()` to register handlers, and injects the `webview()` string into the webview before the page loads.

## Built-in Plugins

Butter ships with 20 built-in plugins covering common desktop application needs.

### Window & UI

| Plugin | Capabilities |
|--------|-------------|
| `dialog` | Native open, save, and folder selection dialogs |
| `navigation` | Webview navigation control (back, forward, reload) |
| `findinpage` | In-page text search with highlight and match cycling |
| `dock` | macOS Dock badge, bounce, and progress bar |

### System

| Plugin | Capabilities |
|--------|-------------|
| `tray` | System tray icon with context menu |
| `notifications` | OS notification center with actions and grouping |
| `clipboard` | Read and write system clipboard (text, image, rich text) |
| `globalshortcuts` | Register hotkeys that work when the app is unfocused |
| `shell` | Open URLs, files, and folders in the default application |
| `theme` | Detect and respond to system light/dark mode changes |
| `lifecycle` | App lifecycle events (ready, will-quit, activate, reopen) |

### Data & Storage

| Plugin | Capabilities |
|--------|-------------|
| `fs` | Sandboxed file system access (read, write, watch) |
| `securestorage` | Encrypted key-value storage backed by OS keychain |
| `downloads` | Download files with progress tracking and destination control |

### Monitoring

| Plugin | Capabilities |
|--------|-------------|
| `network` | Online/offline detection and connectivity change events |
| `logging` | Structured logging to file with rotation and log levels |
| `crashreporter` | Capture and report uncaught exceptions and native crashes |

### Updates

| Plugin | Capabilities |
|--------|-------------|
| `autoupdater` | Check for updates, download, and apply new versions |

### Localization

| Plugin | Capabilities |
|--------|-------------|
| `i18n` | Internationalization with locale detection and string lookup |
| `accessibility` | Screen reader announcements and accessibility attributes |

## Using a Plugin in the Webview

Once registered, the plugin's webview API is available on `window.butter` (or however the plugin chose to attach it):

```ts
// src/app/main.ts

// Read from clipboard
const text = await window.butter.clipboard.read()

// Write to clipboard
await window.butter.clipboard.write("hello from butter")
```

If the plugin attaches its API under a namespace (`window.butter.clipboard`), add types to `src/env.d.ts` so TypeScript knows about it:

```ts
// src/env.d.ts
declare global {
  const butter: {
    invoke: (action: string, data?: unknown) => Promise<unknown>
    on: (action: string, handler: (data: unknown) => void) => void
    clipboard: {
      read: () => Promise<string>
      write: (text: string) => Promise<void>
    }
  }
}

export {}
```

## Plugin with Push Events

Plugins can also push events from the host to the webview using `send`:

```ts
// A plugin that watches a directory and fires events on changes
import type { Plugin } from "butter"
import { watch } from "fs"

const filewatcher: Plugin = {
  name: "filewatcher",

  host: ({ on, send }) => {
    const watchers = new Map<string, ReturnType<typeof watch>>()

    on("filewatcher:start", (path) => {
      const watcher = watch(path as string, { recursive: true }, (eventType, filename) => {
        send("filewatcher:change", { path: filename, type: eventType })
      })
      watchers.set(path as string, watcher)
    })

    on("filewatcher:stop", (path) => {
      const watcher = watchers.get(path as string)
      if (watcher) {
        watcher.close()
        watchers.delete(path as string)
      }
    })
  },

  webview: () => `
    window.butter.fileWatcher = {
      start: (path) => butter.invoke("filewatcher:start", path),
      stop: (path) => butter.invoke("filewatcher:stop", path),
      onChange: (handler) => butter.on("filewatcher:change", handler),
    }
  `,
}

export default filewatcher
```

Webview usage:

```ts
window.butter.fileWatcher.onChange((event) => {
  console.log(`${event.path} was ${event.type}`)
})

await window.butter.fileWatcher.start("/path/to/watch")
```

## Plugin Guidelines

- Prefix all action names with the plugin name to avoid collisions: `myplugin:action`
- Keep `webview()` small — it is injected as a raw string, not bundled
- Use `host()` for anything that needs Bun APIs: file system, network, native process calls
- Plugins share the same `on`/`send` namespace as your host code. Pick unique action names.
- Plugins are loaded in the order listed in `butter.yaml`

## Publishing a Plugin

A plugin is just a Bun/npm package that exports a `Plugin` as its default export:

```json
{
  "name": "butter-plugin-clipboard",
  "version": "1.0.0",
  "module": "index.ts",
  "type": "module",
  "peerDependencies": {
    "butter": "*"
  }
}
```

Users install it and add it to `butter.yaml`:

```bash
bun add butter-plugin-clipboard
```

```yaml
plugins:
  - butter-plugin-clipboard
```
