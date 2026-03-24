# Butter Tutorial

Butter is a lightweight desktop app framework for building native applications with TypeScript, HTML, and CSS. It uses the system webview (WKWebView on macOS, WebKitGTK on Linux) and Bun as the runtime — no bundled browser engine, no web servers, no Rust.

## How It Works

Butter runs two processes:

```
Bun process (parent)          Native shim (child)
  Your host TypeScript    <--> Native window
  IPC handlers                WKWebView / WebKitGTK
  send() / on()               Your HTML + JS
                 shared memory ring buffer
```

Your TypeScript runs in Bun. Your UI runs in the system webview. They communicate through a shared memory ring buffer — no sockets, no HTTP.

## Comparison

|                | Electron   | Tauri        | Butter           |
|----------------|------------|--------------|------------------|
| Webview        | Chromium   | System       | System           |
| Backend        | Node.js    | Rust         | Bun (TypeScript) |
| Binary size    | ~200MB     | ~5MB         | ~60MB            |
| IPC            | JSON pipe  | JSON commands| Shared memory    |
| Language       | JS/TS      | Rust + JS/TS | TypeScript only  |

## Table of Contents

1. [Getting Started](./gettingstarted.md) — Install, create a project, run it
2. [IPC](./ipc.md) — invoke/on patterns, async handlers, error handling
3. [Menus](./menus.md) — Native menus, shortcuts, handling custom actions
4. [Building](./building.md) — Compile to a single binary for distribution
5. [Plugins](./plugins.md) — Creating and using plugins

## Project Structure

A new Butter project looks like this:

```
myapp/
  src/
    app/
      index.html       # Webview entry point
      main.ts          # Frontend TypeScript
      styles.css       # Styles
    host/
      index.ts         # Host TypeScript (runs in Bun)
      menu.ts          # Native menu definition
    env.d.ts           # Type declarations for the webview global
  butter.yaml          # Project configuration
  package.json
```

Two directories, two sides:

- `src/app/` — everything that runs in the webview (HTML, CSS, TypeScript)
- `src/host/` — everything that runs in Bun (IPC handlers, file I/O, menus)
