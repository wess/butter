# CLI Reference

The `butter` CLI is the single entry point for creating, developing, and shipping Butter applications. It is implemented in `src/cli/index.ts` and dispatched via `bun run` or the `butter` binary after installation.

## Usage

```
butter <command> [arguments]
```

If no command is provided, or `help` is passed, the usage summary is printed.

---

## Commands

### `butter init <name>`

Scaffolds a new Butter project in a subdirectory named `<name>`.

**Arguments**

| Argument | Required | Description |
|---|---|---|
| `name` | yes | Directory name for the new project. Used as the project name in generated files. |

**Behavior**

1. Resolves `<name>` relative to the current working directory.
2. Checks for an existing `butter.yaml` in the target directory; exits with an error if one is found.
3. Copies the embedded template files, replacing the `{{name}}` placeholder with the project name.
4. Prints next steps (`cd <name>`, `bun install`, `bun run dev`).

**Template files created**

```
butter.yaml
package.json
src/app/index.html
src/app/main.ts
src/app/styles.css
src/host/index.ts
src/host/menu.ts
src/env.d.ts
```

**Example**

```sh
butter init myapp
cd myapp
bun install
bun run dev
```

---

### `butter dev`

Starts development mode from the current working directory.

**Arguments**

None. The project directory is always `process.cwd()`.

**Behavior**

1. Runs `doctor` checks (Bun, compiler, WebView). Exits on failure.
2. Loads `butter.yaml` (or defaults) from the project directory.
3. Compiles the native shim binary to `.butter/shim` if the binary is missing or the source is newer than the binary.
4. Bundles `src/app/index.html` (and its imports) via Bun's bundler into `.butter/build/`. JS modules and CSS are inlined into the HTML to satisfy WKWebView's `file://` restrictions.
5. Creates a 128 KB POSIX shared memory region named `/butter_<pid>` and two named semaphores (`/butter_<pid>.tb`, `/butter_<pid>.ts`).
6. Passes `BUTTER_TITLE` (and optionally `BUTTER_MENU`) to the shim process via environment variables, then spawns the shim.
7. Imports `src/host/index.ts` dynamically, which registers handlers via `on()`.
8. Enters a poll loop at approximately 60 Hz. Incoming `invoke` messages are dispatched to registered handlers; responses are written back. Outgoing `event` messages queued by `send()` are flushed each tick.
9. Watches `src/` for file changes. On change, re-bundles and sends a `control/reload` message to the shim, which calls `WKWebView.reload()`.
10. Cleans up shared memory and exits when the window is closed or SIGINT is received.

**Example**

```sh
cd myapp
butter dev
```

---

### `butter compile`

Produces a standalone, self-contained binary in `dist/<appname>`.

**Arguments**

None. The project directory is always `process.cwd()`.

**Behavior**

1. Runs `doctor` checks. Exits on failure.
2. Loads `butter.yaml`.
3. Compiles the native shim if stale.
4. Bundles app assets with minification enabled into `.butter/build/`. Inlines JS and CSS into the HTML.
5. Base64-encodes the shim binary and `semhelper.dylib`.
6. Collects all built assets as base64 strings.
7. Generates a bootstrap TypeScript module (`.butter/bootstrap.ts`) that:
   - Extracts the shim and assets to a temp directory at startup.
   - Opens shared memory and semaphores via FFI.
   - Imports the host wrapper (which sets up the runtime and imports `src/host/index.ts`).
   - Spawns the shim.
   - Runs the IPC poll loop.
   - Cleans up on exit.
8. Compiles the bootstrap with `bun build --compile` into `dist/<appname>`.

The app name is derived from `window.title` in `butter.yaml`, lowercased and stripped of non-alphanumeric characters.

**Output**

```
dist/<appname>    # self-contained executable, no external runtime required
```

**Example**

```sh
cd myapp
butter compile
./dist/myapp
```

---

### `butter doctor`

Checks that all platform prerequisites are installed and functional.

**Arguments**

None.

**Checks performed**

| Check | macOS | Linux |
|---|---|---|
| Bun | `Bun.version` | `Bun.version` |
| Compiler | `clang --version` | `tcc -v` |
| WebView | WKWebView (always available) | `pkg-config --exists webkit2gtk-4.1` |

**Output**

Each check prints a status line. If any check fails, a remediation hint is printed.

**Remediation hints**

| Failure | Fix |
|---|---|
| Bun not found | `curl -fsSL https://bun.sh/install \| bash` |
| clang not found (macOS) | `xcode-select --install` |
| tcc not found (Linux) | `sudo apt install tcc` |
| WebKitGTK missing (Linux) | `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev` |

**Example**

```sh
butter doctor
  Bun ................ v1.2.0
  Compiler ........... clang 16.0.0
  Webview ............ WKWebView (macOS)

  All checks passed.
```

---

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Error (doctor failure, missing argument, project already exists, etc.) |
