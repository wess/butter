# Architecture Reference

This document describes Butter's internal design: how processes are organized, how shared memory is laid out, how the ring buffer protocol works, and how the bridge is injected into the webview.

---

## Process Model

A running Butter application consists of exactly two operating system processes.

```
┌─────────────────────────────────┐      ┌──────────────────────────────────┐
│  Host Process (Bun)             │      │  Shim Process (native binary)    │
│                                 │      │                                  │
│  src/host/index.ts              │      │  darwin.m / linux.c / windows.c  │
│  Runtime, IPC poll loop         │      │  Native webview (per platform)   │
│  Handles invoke, sends events   │◄────►│  Handles OS events, renders HTML │
│                                 │      │                                  │
└─────────────────────────────────┘      └──────────────────────────────────┘
           │                                          │
           └──────────── shared memory ───────────────┘
                    /butter_<pid>  (128 KB)
                    /butter_<pid>.tb  (semaphore)
                    /butter_<pid>.ts  (semaphore)
```

**Host process** — Bun runs `src/host/index.ts`. This file imports from `"butter"` and calls `on()` to register handlers. The CLI creates a `Runtime` instance, stores it on `globalThis.__butterRuntime`, then imports the host file. After that, the CLI's poll loop drives all IPC.

**Shim process** — A compiled C/Objective-C binary. On macOS it uses Cocoa and WKWebView; on Linux it uses GTK and WebKitGTK; on Windows it uses Win32 and WebView2. The shim opens (not creates) the shared memory region by name, maps it, and opens the signaling primitives (semaphores on macOS/Linux, named events on Windows). It owns the native window and dispatches all windowing events on the main thread.

**Lifecycle**

1. The host process creates shared memory and semaphores.
2. The host spawns the shim, passing the shared memory name and HTML path as command-line arguments.
3. Both processes map the same memory region.
4. The shim runs the native event loop; the host runs the Bun event loop with a `setTimeout`-based poll.
5. When the window is closed, the shim writes a `control/quit` message and calls `[NSApp terminate]`. The host detects the quit control message or the shim's process exit and cleans up.

---

## Shared Memory Layout

The shared memory region is exactly 128 KB (`SHM_SIZE = 128 * 1024`). It is divided into three sections:

```
Offset 0                                            Offset 131072
│                                                              │
├── Header (64 bytes) ──┬── Ring TB (32704 bytes) ──┬── Ring TS (32704 bytes) ──┤
│  TB_WCUR  [0..3]      │                           │                           │
│  TB_RCUR  [4..7]      │  to-bun ring              │  to-shim ring             │
│  TS_WCUR  [8..11]     │  (shim writes,            │  (host writes,            │
│  TS_RCUR  [12..15]    │   host reads)             │   shim reads)             │
│  (reserved [16..63])  │                           │                           │
└───────────────────────┴───────────────────────────┴───────────────────────────┘
```

**Constants**

| Name | Value | Description |
|---|---|---|
| `SHM_SIZE` | `131072` (128 KB) | Total shared memory size |
| `HEADER_SIZE` | `64` | Size of the header section |
| `RING_SIZE` | `32704` | Size of each ring buffer: `(SHM_SIZE - HEADER_SIZE) / 2` |
| `RING_TB_OFF` | `64` | Byte offset of the to-bun ring |
| `RING_TS_OFF` | `32768` | Byte offset of the to-shim ring |

**Header fields** (all little-endian uint32)

| Offset | Name | Owner | Description |
|---|---|---|---|
| 0 | `TB_WCUR` | shim writes | Write cursor for the to-bun ring |
| 4 | `TB_RCUR` | host writes | Read cursor for the to-bun ring |
| 8 | `TS_WCUR` | host writes | Write cursor for the to-shim ring |
| 12 | `TS_RCUR` | shim writes | Read cursor for the to-shim ring |
| 16–63 | (reserved) | — | Zeroed; available for future use |

Each cursor is a byte offset within its respective ring, modulo `RING_SIZE`. Cursors wrap around at `RING_SIZE`.

---

## Ring Buffer Protocol

Both rings use the same framing scheme. Each message is written as:

```
┌────────────────────────────────┬──────────────────────────────────────────┐
│  Length prefix (4 bytes, LE)   │  JSON payload (length bytes)             │
└────────────────────────────────┴──────────────────────────────────────────┘
```

The length prefix is a little-endian uint32 specifying the number of bytes in the JSON payload. It does not include itself.

**Available space calculation**

```
available(w, r) = w >= r ? w - r : RING_SIZE - r + w
free(w, r)      = r > w ? r - w - 1 : RING_SIZE - (w - r) - 1
```

`free` always reserves one byte to distinguish a full buffer from an empty one.

**Write procedure (host side, `writeToShim`)**

1. Read `TS_WCUR` (w) and `TS_RCUR` (r) from the header.
2. Compute `needed = 4 + len(payload)`. Return `false` if `free(w, r) < needed`.
3. Write 4 length bytes at positions `(w+0) % RING_SIZE` through `(w+3) % RING_SIZE` in the to-shim ring.
4. Write each payload byte at `(w+4+i) % RING_SIZE`.
5. Update `TS_WCUR` to the new write cursor.
6. Call `sem_post(semToShim)` to signal the shim.

**Read procedure (host side, `readFromShim`)**

1. Read `TB_WCUR` (w) and `TB_RCUR` (r).
2. If `available(w, r) < 4`, stop (no complete length prefix).
3. Read 4 bytes at positions `(r+0..3) % RING_SIZE` to get `len`.
4. If `available(w, (r+4) % RING_SIZE) < len`, stop (payload not yet written).
5. Read `len` bytes starting at `(r+4) % RING_SIZE` to get the JSON.
6. Update `TB_RCUR` to the new read cursor.
7. Parse the JSON as `IpcMessage`.
8. Repeat from step 1 until no more complete messages.

The shim (in C/Objective-C) performs symmetric operations on the opposite rings.

**Signaling**

Two signaling primitives are created alongside the shared memory region:

| Platform | Mechanism | Names |
|---|---|---|
| macOS/Linux | POSIX named semaphores | `/butter_<pid>.tb`, `/butter_<pid>.ts` |
| Windows | Win32 named events (auto-reset) | `butter_<pid>_tb`, `butter_<pid>_ts` |

| Name suffix | Signaled by | Waited on by |
|---|---|---|
| `.tb` / `_tb` | shim (after writing to the to-bun ring) | host (optional; currently uses polling) |
| `.ts` / `_ts` | host (after writing to the to-shim ring) | shim (poll timer checks for signal) |

In development mode the host uses `setTimeout`-based polling at ~60 Hz rather than blocking on the signal. The signal is still posted after every write to ensure the shim wakes promptly.

Note: On Windows, shared memory names have no leading `/` (e.g., `butter_1234` instead of `/butter_1234`).

---

## ARM64 Variadic ABI Workaround (macOS/Linux only)

`shm_open` and `sem_open` are variadic C functions. Bun's FFI layer cannot correctly call variadic functions on Apple Silicon (ARM64) because the ABI requires variadic arguments to be passed differently.

To work around this, `src/ipc/shmem/darwin.ts` compiles a small C helper (`src/ipc/native/semhelper.c`) into a shared library (`semhelper.dylib` on macOS, `semhelper.so` on Linux). The helper exports non-variadic wrappers:

```c
int shm_open_create(const char *name, int flags, unsigned mode);
int shm_open_existing(const char *name, int flags);
sem_t *sem_open_create(const char *name, int flags, unsigned mode, unsigned value);
sem_t *sem_open_existing(const char *name, int flags);
```

These are called via `bun:ffi` without variadic arguments. The helper is auto-compiled at startup if missing or stale. In compiled binaries, the shared library is base64-embedded and extracted to a temp directory at launch.

This workaround is not needed on Windows, which uses `CreateFileMappingA`, `MapViewOfFile`, and `CreateEventA` from `kernel32.dll` — none of which are variadic.

---

## Bundle and Inline Pass

WKWebView refuses to load external ES module scripts (`<script type="module" src="...">`) from `file://` URLs due to CORS restrictions. Butter works around this by post-processing the bundled HTML:

1. Bun bundles the entry HTML and all its imports into `.butter/build/`.
2. After bundling, all `<script src="./filename">` tags are replaced with inline `<script type="module">` tags containing the file's full content.
3. All `<link href="./filename">` tags are replaced with inline `<style>` tags.
4. The resulting self-contained HTML is what the shim loads via `loadFileURL:allowingReadAccessToURL:`.

In `dev` mode this runs with sourcemaps enabled and no minification. In `compile` mode minification is enabled.

---

## Bridge Injection

Before the webview loads any page content, the shim injects `BRIDGE_JS` using `WKUserScript` with `WKUserScriptInjectionTimeAtDocumentStart`. This guarantees that `window.butter` exists before any application scripts run.

The bridge maintains two internal maps:

- `p` — pending invocations: `Map<id, { resolve, reject }>`. Populated by `butter.invoke()`; consumed by the `response` branch of `__butterReceive`.
- `l` — event listeners: `Map<action, handler[]>`. Populated by `butter.on()`; called by the `event` branch of `__butterReceive`.

Messages flow from the webview to the shim via `window.webkit.messageHandlers.butter.postMessage(json)`, which is the WKWebView native message channel. The shim's `WKScriptMessageHandler` receives the string and writes it to the to-bun ring.

Messages flow from the shim to the webview via `WKWebView.evaluateJavaScript`, which calls `window.__butterReceive(escapedJson)` on each poll tick. The shim escapes backslashes, single quotes, and newlines before interpolating the JSON into the JS call.

---

## Poll Timer

The shim schedules an `NSTimer` at `1.0/60.0` seconds (`~16.7 ms`) on the main run loop. On each tick (`pollTimer:`), it drains the to-shim ring by calling `ring_read_ts()` in a loop until no more messages are available, then dispatches each message:

- `control/quit` — calls `[NSApp terminate]`.
- `control/reload` — calls `[webview reload]`.
- `response` or `event` — calls `evaluateJavaScript` to dispatch into the webview.

The host runs an equivalent poll at `Math.floor(1000 / 60)` ms (16 ms) using `setTimeout`. On each tick it:

1. Drains the to-bun ring (`readFromShim`).
2. Dispatches each `invoke` to the registered handler; writes the response back.
3. Dispatches each `event` to `runtime.dispatch` (for menu actions etc.).
4. Flushes the outgoing queue from `runtime.drainOutgoing()` into the to-shim ring.
5. Posts the to-shim semaphore if any messages were written.

---

## Compiled Binary Structure

`butter compile` produces a single self-contained executable by:

1. Base64-encoding the shim binary (and `semhelper.dylib`/`.so` on macOS/Linux).
2. Base64-encoding every file in `.butter/build/`.
3. Embedding all of the above as string literals in a generated TypeScript bootstrap module.
4. Compiling the bootstrap with `bun build --compile`, which embeds the Bun runtime into the binary.

At startup, the compiled binary extracts all embedded files to a temp directory under `os.tmpdir()/butter-<pid>/`, sets the shim executable bit, and proceeds identically to development mode. On exit (normal or SIGINT), the temp directory and shared memory objects are cleaned up.
