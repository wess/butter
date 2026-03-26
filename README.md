<p align="center">
  <img src="assets/logo.png" alt="Butter" width="200" />
</p>

<h1 align="center">Butter</h1>

<p align="center">A lightweight desktop app framework for building native applications with TypeScript, HTML, and CSS. Powered by <a href="https://bun.sh">Bun</a>.</p>

Butter gives you a native window with a webview and a direct IPC bridge between your TypeScript backend and your frontend — no bundled browser engine, no background servers, and a single-file binary output. Write native C or [Moxy](https://github.com/moxylang/moxy) extensions and call them directly from TypeScript.

## Why Butter?

| | Electron | Tauri | Butter |
|---|----------|-------|--------|
| Runtime | Chromium (~150MB) | System webview | System webview |
| Backend | Node.js | Rust | Bun (TypeScript) |
| Native extensions | N/A | Rust | C / [Moxy](https://github.com/moxylang/moxy) |
| Binary size | ~200MB | ~5MB | ~60MB |
| IPC | JSON over IPC pipe | JSON commands | Shared memory ring buffer |
| Language | JS/TS | Rust + JS/TS | TypeScript + C/Moxy |
| Build tool | webpack/vite | Cargo | Bun |

Butter's sweet spot: you want native desktop apps with TypeScript on both sides, native performance where you need it via C/Moxy, and zero configuration.

## Installation

Requires [Bun](https://bun.sh) v1.2+.

**Install via Bun (recommended):**

```bash
bun add -g butterframework
```

**Install via curl:**

```bash
curl -fsSL https://raw.githubusercontent.com/wess/butter/main/scripts/install.sh | bash
```

**Install via Homebrew:**

```bash
brew tap wess/packages
brew install butter
```

Verify installation:

```bash
butter doctor
```

## Quick Start

```bash
# Create a new project
butter init myapp
cd myapp
bun install

# Start development (opens a native window)
bun run dev

# Build a single binary
bun run build

# Create an .app bundle (macOS)
butter bundle
```

Templates available: `vanilla` (default), `react`, `svelte`, `vue`

```bash
butter init myapp --template react
```

## How It Works

Butter runs two processes:

```
+--------------------------+     +--------------------------+
|   Bun Process (parent)   |     |   Native Shim (child)    |
|                          |     |                          |
|  Your TypeScript host    |<--->|  Native window           |
|  code runs here          | IPC |  WKWebView (macOS)       |
|                          |     |  WebKitGTK (Linux)       |
|  import { on } from      |     |  WebView2 (Windows)      |
|    "butter"              |     |                          |
|                          |     |  Your HTML/CSS/JS        |
|  C/Moxy native modules   |     |  runs here               |
|  via FFI                 |     |                          |
+--------------------------+     +--------------------------+
         Shared Memory Ring Buffer
```

- **No web server** — assets served via `butter://` custom protocol
- **No bundled browser** — uses the OS native webview
- **Shared memory IPC** — fast communication via ring buffers
- **Native extensions** — write C or Moxy, auto-compiled and bound via FFI
- **Single binary** — `butter compile` produces one executable

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
    native/            # C/Moxy native extensions (optional)
      math.mxy         # Compiled to shared lib, auto-bound via FFI
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
  icon: assets/icon.png    # optional

build:
  entry: src/app/index.html
  host: src/host/index.ts

bundle:
  identifier: com.example.myapp
  category: public.app-category.utilities
  urlSchemes:
    - myapp

security:
  csp: "default-src 'self' butter:"
  allowlist:
    - "dialog:*"
    - "greet"

splash: src/app/splash.html

plugins:
  - butter-plugin-dialog
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

// Window events
on("window:resize", (data: { width: number; height: number }) => {
  console.log("Window resized to", data.width, data.height)
})

on("window:focus", () => console.log("Window focused"))
on("window:blur", () => console.log("Window blurred"))
```

### Webview Side (Browser)

Your frontend code in `src/app/main.ts`:

```ts
// Call host handlers
const greeting = await butter.invoke("greet", "World")

// With timeout (rejects if no response within 5 seconds)
const data = await butter.invoke("fetch:data", url, { timeout: 5000 })

// Stream large results with progress
await butter.stream("process:file", filePath, (chunk) => {
  console.log("Progress:", chunk)
})

// Listen for events from the host
butter.on("status:updated", (data) => {
  console.log(data.ready)
})

// Stop listening
butter.off("status:updated", handler)

// Native context menu
const action = await butter.contextMenu([
  { label: "Copy", action: "copy" },
  { separator: true },
  { label: "Delete", action: "delete" },
])
```

The `butter` global is automatically injected into the webview. TypeScript types are provided via `src/env.d.ts`.

### Native Extensions (C / Moxy)

Write performance-critical code in C or [Moxy](https://github.com/moxylang/moxy) and call it directly from TypeScript. Butter auto-compiles and generates FFI bindings.

**Moxy** (`src/native/math.mxy`):

```moxy
// @butter-export
int fibonacci(int n) {
  if (n <= 1) { return n; }
  int a = 0;
  int b = 1;
  for i in 2..n+1 {
    int tmp = b;
    b = a + b;
    a = tmp;
  }
  return b;
}
```

**C** (`src/native/crypto.c`):

```c
#include "butter.h"

BUTTER_EXPORT(
  int fast_hash(const char *input, int len) {
    int hash = 0;
    for (int i = 0; i < len; i++) hash = hash * 31 + input[i];
    return hash;
  }
)
```

**Use from TypeScript:**

```ts
import { native } from "butter/native"

const math = await native("math")
const fib = math.fibonacci(20)  // 6765 — computed in native code

const crypto = await native("crypto")
const hash = crypto.fast_hash("hello", 5)
```

Butter parses `BUTTER_EXPORT()` blocks (C) or `// @butter-export` annotations (Moxy), extracts function signatures, compiles to a shared library, and generates typed TypeScript bindings. Recompiles only when source changes.

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
- Standard edit actions map to native OS behavior
- Custom actions fire as IPC events — handle with `on("file:new", ...)`
- On macOS, the app menu is built automatically from your app title

### Typed IPC

For type-safe IPC between host and webview:

```ts
// shared/types.ts — define your IPC contract
import type { InvokeMap } from "butter"

export type AppInvokes = {
  greet: { input: string; output: string }
  "math:add": { input: { a: number; b: number }; output: number }
}
```

```ts
// host side
import { createTypedHandlers } from "butter/types"
const { on } = createTypedHandlers<AppInvokes>()
on("greet", (name) => `Hello, ${name}!`)  // fully typed
```

```ts
// webview side
import { createTypedInvoke } from "butter/types"
const { invoke } = createTypedInvoke<AppInvokes>()
const greeting = await invoke("greet", "World")  // typed as string
```

## CLI

```
butter init <name> [--template vanilla|react|svelte|vue]
                     Create a new project
butter dev           Start development mode (hot reload + DevTools)
butter compile       Build a single-file binary
butter bundle        Create OS-native app package (.app / AppDir)
butter sign          Code-sign and notarize the app bundle
butter doctor        Check platform prerequisites
```

### `butter dev`

Starts development mode:
1. Compiles native extensions (C/Moxy) if present
2. Compiles the native shim (cached)
3. Bundles frontend assets
4. Opens a native window with DevTools enabled (right-click to inspect)
5. Watches for file changes and reloads automatically

### `butter compile`

Produces a single executable:
1. Compiles native extensions and shim
2. Bundles and embeds all assets
3. Strips debug symbols
4. Output: `dist/<appname>` (~60MB)

### `butter bundle`

Creates an OS-native app package:
- **macOS**: `.app` bundle with `Info.plist`, icon, and the compiled binary
- **Linux**: AppDir structure with `.desktop` file and `AppRun` symlink

### `butter doctor`

```
$ butter doctor

  Bun ................. v1.3.11
  Compiler ............ clang 22.1.1
  Webview ............. WKWebView (macOS)

  All checks passed.
```

## Plugins

Built-in plugins for common native capabilities:

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

```ts
import { on } from "butter"

// File dialogs (via osascript on macOS)
on("open-file", async () => {
  const path = await butter.invoke("dialog:open", { prompt: "Select a file" })
  return path
})
```

## Platform Support

| Platform | Webview | Compiler | Status |
|----------|---------|----------|--------|
| macOS | WKWebView | clang (Xcode CLI tools) | Supported |
| Linux | WebKitGTK | cc/gcc | Supported |
| Windows | WebView2 | MSVC/MinGW | Supported |

### macOS

No additional dependencies — WKWebView and clang ship with macOS.

### Linux

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel gtk3-devel

# Arch
sudo pacman -S webkit2gtk-4.1 gtk3
```

## Architecture

```
App Code (TS/HTML/CSS)          You write this
Native Extensions (C/Moxy)      Optional, auto-compiled
Butter Runtime (Bun/TS)         CLI, IPC bridge, API, FFI bindings
Platform Shim (ObjC/C)          Native window + webview
```

### IPC

Shared memory with two ring buffers. Messages are length-prefixed JSON. Signaling via POSIX named semaphores.

```
+----------+------------------+------------------+
| Header   | Host -> Webview  | Webview -> Host  |
| (64B)    | ring buffer      | ring buffer      |
+----------+------------------+------------------+
             128KB total shared memory
```

Assets are served via the `butter://` custom protocol, eliminating `file://` CORS restrictions.

## Development

```bash
git clone https://github.com/wess/butter.git
cd butter
bun install

# Run the example (includes native Moxy extension)
cd example/hello
bun install
bun run dev

# Run tests
cd ../..
bun test
```

## License

MIT
