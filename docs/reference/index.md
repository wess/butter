# Butter Reference

Butter is a minimal desktop application framework for macOS and Linux. It pairs a Bun-powered host process with a native WebView window, using shared memory ring buffers for zero-copy IPC between the two.

## Reference Documents

| Document | Contents |
|---|---|
| [cli.md](./cli.md) | All CLI commands, flags, and usage examples |
| [api.md](./api.md) | Host-side and webview-side API surfaces |
| [config.md](./config.md) | `butter.yaml` schema, all options with types and defaults |
| [types.md](./types.md) | TypeScript types exported from the `butter` package |
| [native.md](./native.md) | Native extensions (C/Moxy), BUTTER_EXPORT, type mapping, compilation |
| [architecture.md](./architecture.md) | Process model, shared memory layout, ring buffer protocol, bridge injection |

## Concepts

**Host process** — A Bun process that runs your `src/host/index.ts`. It owns the application lifecycle, registers IPC handlers via `on()`, and pushes events to the webview via `send()`.

**Shim** — A compiled native binary (`darwin.m` on macOS, `linux.c` on Linux) that creates a native window, embeds a WebView, and communicates with the host process via POSIX shared memory.

**Webview** — The UI layer. HTML/CSS/JS runs inside WKWebView (macOS) or WebKitGTK (Linux). The bridge injects `window.butter` at document start, providing `butter.invoke()` and `butter.on()`.

**IPC** — All messages between the host and the webview pass through two lock-free ring buffers in a single 128 KB shared memory region. The shim writes to the `to-bun` ring; the host writes to the `to-shim` ring. POSIX named semaphores signal across process boundaries.

## Supported Platforms

| Platform | WebView | Compiler |
|---|---|---|
| macOS (arm64 / x86_64) | WKWebView | clang (Xcode Command Line Tools) |
| Linux | WebKitGTK 4.1 | cc (gcc, clang, or tcc) |
| Windows | WebView2 | MSVC (cl.exe) or MinGW (gcc) |

## Project Layout

A generated project has this structure:

```
myapp/
  butter.yaml            # project configuration
  package.json           # declares "butter" as a dependency
  src/
    app/
      index.html         # webview entry point
      main.ts            # webview script (runs in browser context)
      styles.css         # webview styles
    host/
      index.ts           # host entry point (runs in Bun context)
      menu.ts            # optional native menu definition
    env.d.ts             # ambient type declarations for window.butter
```
