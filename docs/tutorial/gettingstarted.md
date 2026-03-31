# Getting Started

## Prerequisites

Butter needs Bun and a C compiler. Run `butter doctor` at any time to check your environment.

### macOS

Bun and clang are all you need. clang ships with Xcode Command Line Tools:

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install Xcode Command Line Tools (if you haven't already)
xcode-select --install
```

### Linux

Requires Bun plus WebKitGTK and GTK3:

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel gtk3-devel

# Arch
sudo pacman -S webkit2gtk-4.1 gtk3
```

### Windows

Requires Bun for Windows and a C compiler (MSVC or MinGW). The WebView2 runtime is pre-installed on Windows 10 21H2+ and Windows 11.

```powershell
# Install Bun
powershell -c "irm bun.sh/install.ps1 | iex"

# Install Visual Studio Build Tools (for cl.exe)
# Or install MinGW-GCC
```

## Installation

Install the Butter CLI globally via Bun:

```bash
bun install -g butter
```

Or run it without installing using `bunx`:

```bash
bunx butter init myapp
```

## Creating a Project

```bash
butter init myapp
cd myapp
bun install
```

This creates:

```
myapp/
  src/
    app/
      index.html
      main.ts
      styles.css
    host/
      index.ts
      menu.ts
    env.d.ts
  butter.yaml
  package.json
```

## Running in Development

```bash
bun run dev
# or directly:
butter dev
```

Development mode:

1. Checks prerequisites (same as `butter doctor`)
2. Compiles the native shim if needed (cached after the first run)
3. Bundles your frontend assets
4. Opens a native window with your app
5. Watches `src/` for changes and reloads automatically

## The Default App

The generated project has a minimal working example. The host handles one IPC action:

```ts
// src/host/index.ts
import { on } from "butter"

on("greet", (name) => {
  return `Hello, ${name}!`
})
```

The webview calls it on load:

```ts
// src/app/main.ts
const el = document.getElementById("greeting")
const greeting = await butter.invoke("greet", "Butter")

if (el) {
  el.textContent = greeting as string
}
```

And the HTML wires them together:

```html
<!-- src/app/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>myapp</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <div id="app">
    <h1 id="greeting">Loading...</h1>
  </div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

## Configuration

`butter.yaml` controls the window and build paths:

```yaml
window:
  title: My App
  width: 800
  height: 600

build:
  entry: src/app/index.html   # Webview entry point
  host: src/host/index.ts     # Host entry point
```

All fields have defaults. A minimal `butter.yaml` with just the title works:

```yaml
window:
  title: My App
```

## Checking Your Environment

```bash
butter doctor
```

Output:

```
  Bun ................. v1.2.0
  Compiler ............ clang 16.0.0
  Webview ............. WKWebView (macOS)

  All checks passed.
```

If something is missing, `doctor` shows the fix command.

## Next Steps

- [IPC](./ipc.md) — learn how host and webview communicate
- [Menus](./menus.md) — add native menus and keyboard shortcuts
- [Building](./building.md) — compile a single binary for distribution
