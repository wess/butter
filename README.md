<p align="center">
  <img src="assets/logo.png" alt="Butter" width="200" />
</p>

<h1 align="center">Butter</h1>

<p align="center">A lightweight desktop app framework for building native applications with TypeScript, HTML, and CSS. Powered by <a href="https://bun.sh">Bun</a>.</p>

Butter gives you a native window with a webview and a direct IPC bridge between your TypeScript backend and your frontend — no bundled browser engine, no background servers, and a single-file binary output.

## Why Butter?

| | Electron | Tauri | Butter |
|---|----------|-------|--------|
| Runtime | Chromium (~150MB) | System webview | System webview |
| Backend | Node.js | Rust | Bun (TypeScript) |
| Binary size | ~200MB | ~5MB | ~60MB |
| IPC | JSON over IPC pipe | JSON commands | Shared memory ring buffer |
| Language | JS/TS | Rust + JS/TS | TypeScript only |
| Build tool | webpack/vite | Cargo | Bun |

Butter's sweet spot: you want native desktop apps with TypeScript on both sides, minimal binary size, and zero configuration.

## Quick Start

```bash
# Install Bun if you haven't
curl -fsSL https://bun.sh/install | bash

# Create a new project
bunx butter init myapp
cd myapp
bun install

# Start development
bun run dev

# Build a single binary
bun run build
```

## How It Works

Butter runs two processes:

```
┌──────────────────────────┐     ┌──────────────────────────┐
│   Bun Process (parent)   │     │   Native Shim (child)    │
│                          │     │                          │
│  Your TypeScript host    │◄───►│  Native window           │
│  code runs here          │ IPC │  WKWebView (macOS)       │
│                          │     │  WebKitGTK (Linux)       │
│  import { on } from      │     │                          │
│    "butter"              │     │  Your HTML/CSS/JS        │
│                          │     │  runs here               │
└──────────────────────────┘     └──────────────────────────┘
         Shared Memory Ring Buffer
```

- **No web server** — HTML is loaded from disk
- **No bundled browser** — uses the OS native webview
- **Shared memory IPC** — fast communication between host and webview via ring buffers
- **Single binary** — `butter compile` produces one executable with everything embedded

## Project Structure

```
myapp/
  src/
    app/
      index.html       # Entry point (loaded in webview)
      main.ts          # Frontend TypeScript
      styles.css       # Styles
    host/
      index.ts         # Backend TypeScript (runs in Bun)
      menu.ts          # Native menu definition (optional)
    env.d.ts           # Type declarations for webview globals
  butter.yaml          # Configuration
  package.json
```

## Configuration

`butter.yaml`:

```yaml
window:
  title: My App
  width: 800
  height: 600

build:
  entry: src/app/index.html
  host: src/host/index.ts
```

## API

### Host Side (Bun)

Your backend code in `src/host/index.ts`:

```ts
import { on, send, getWindow, setWindow } from "butter"

// Handle calls from the webview
on("greet", (name: string) => {
  return `Hello, ${name}!`
})

// Async handlers work too
on("fetch:data", async (url: string) => {
  const res = await fetch(url)
  return await res.json()
})

// Push events to the webview
send("status:updated", { ready: true })

// Window control
setWindow({ title: "New Title" })
const { width, height } = getWindow()
```

### Webview Side (Browser)

Your frontend code in `src/app/main.ts`:

```ts
// Call host handlers
const greeting = await butter.invoke("greet", "World")
console.log(greeting) // "Hello, World!"

// Listen for events from the host
butter.on("status:updated", (data) => {
  console.log(data.ready) // true
})
```

The `butter` global is automatically injected into the webview — no imports needed. TypeScript types are provided via `src/env.d.ts`.

### Menus

Define native menus in `src/host/menu.ts`:

```ts
import type { Menu } from "butter"

export default [
  {
    label: "File",
    items: [
      { label: "New", action: "file:new", shortcut: "CmdOrCtrl+N" },
      { label: "Open", action: "file:open", shortcut: "CmdOrCtrl+O" },
      { separator: true },
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
] satisfies Menu
```

- `CmdOrCtrl` resolves to Cmd on macOS, Ctrl on Linux/Windows
- Standard edit actions (undo, redo, cut, copy, paste) map to native OS behavior
- Custom actions fire as IPC events — handle them with `on("file:new", ...)`
- On macOS, the app menu (About, Hide, Quit) is built automatically from your app title

## CLI

```
butter init <name>    Create a new project
butter dev            Start development mode (with hot reload)
butter compile        Build a single-file binary
butter doctor         Check platform prerequisites
```

### `butter dev`

Starts development mode:
1. Compiles the native shim (cached after first run)
2. Bundles your frontend assets
3. Opens a native window
4. Watches for file changes and reloads automatically

### `butter compile`

Produces a single executable:
1. Bundles frontend assets and inlines them
2. Embeds the native shim binary
3. Compiles everything with `bun build --compile`
4. Output: `dist/<appname>` (~60MB, mostly the Bun runtime)

### `butter doctor`

Checks that your system has the required prerequisites:

```
$ butter doctor

  Bun ................. v1.3.11
  Compiler ............ clang 22.1.1
  Webview ............. WKWebView (macOS)

  All checks passed.
```

## Platform Support

| Platform | Webview | Compiler | Status |
|----------|---------|----------|--------|
| macOS | WKWebView | clang (Xcode CLI tools) | Supported |
| Linux | WebKitGTK | cc/gcc | Written, untested |
| Windows | WebView2 | — | Planned |

### macOS

No additional dependencies — WKWebView and clang ship with macOS.

### Linux

Requires WebKitGTK and GTK3:

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel gtk3-devel

# Arch
sudo pacman -S webkit2gtk-4.1 gtk3
```

## Architecture

Butter has three layers:

```
App Code (TS/HTML/CSS)          You write this
Butter Runtime (Bun/TS)         CLI, IPC bridge, API
Platform Shim (C/ObjC)          Native window + webview
```

### IPC

Communication uses shared memory with two ring buffers (one per direction). Messages are length-prefixed JSON. Synchronization uses POSIX named semaphores.

```
┌──────────┬──────────────────┬──────────────────┐
│ Header   │ Host → Webview   │ Webview → Host   │
│ (64B)    │ ring buffer      │ ring buffer      │
└──────────┴──────────────────┴──────────────────┘
             128KB total shared memory
```

The webview communicates through the native shim's message handler (WKScriptMessageHandler on macOS, WebKitGTK script message handler on Linux). The shim relays messages to/from the shared memory ring buffer.

### Plugin System

Butter has an extensible plugin system for adding native capabilities:

```ts
import type { Plugin } from "butter"

const dialog: Plugin = {
  name: "dialog",
  host: ({ on }) => {
    on("dialog:open", (opts) => openNativeDialog(opts))
  },
  webview: () => `
    window.butter.dialog = {
      open: (opts) => butter.invoke("dialog:open", opts)
    }
  `,
}

export default dialog
```

Register plugins in `butter.yaml`:

```yaml
plugins:
  - butter-plugin-dialog
```

## Development

```bash
# Clone the repo
git clone https://github.com/user/butter.git
cd butter
bun install

# Run the example
cd example/hello
bun install
bun run dev

# Run tests
cd ../..
bun test
```

## License

MIT
