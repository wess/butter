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

**Options**

| Flag | Default | Description |
|---|---|---|
| `--template <name>` | `vanilla` | Project template to use. Available: `vanilla`, `react`, `svelte`, `vue`. |

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

```sh
butter init myapp --template react
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
5. Creates a 128 KB shared memory region and signaling primitives (POSIX semaphores on macOS/Linux, named events on Windows).
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

**Options**

| Flag | Default | Description |
|---|---|---|
| `--target <platform>` | current OS | Target platform: `darwin`, `linux`, or `windows`. Cross-compilation requires the target platform's SDK; in practice this means compiling on the target OS or using a VM/container. |

**Behavior**

1. Runs `doctor` checks. Exits on failure.
2. Loads `butter.yaml`.
3. Compiles the native shim if stale.
4. Bundles app assets with minification enabled into `.butter/build/`. Inlines JS and CSS into the HTML.
5. Base64-encodes the shim binary (and `semhelper.dylib`/`.so` on macOS/Linux).
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

| Check | macOS | Linux | Windows |
|---|---|---|---|
| Bun | `Bun.version` | `Bun.version` | `Bun.version` |
| Compiler | `clang --version` | `tcc -v` | `cl` or `gcc --version` |
| WebView | WKWebView (always available) | `pkg-config --exists webkit2gtk-4.1` | WebView2 (registry check) |

**Output**

Each check prints a status line. If any check fails, a remediation hint is printed.

**Remediation hints**

| Failure | Fix |
|---|---|
| Bun not found | `curl -fsSL https://bun.sh/install \| bash` |
| clang not found (macOS) | `xcode-select --install` |
| tcc not found (Linux) | `sudo apt install tcc` |
| WebKitGTK missing (Linux) | `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev` |
| Compiler not found (Windows) | Install Visual Studio Build Tools (MSVC) or MinGW-GCC |
| WebView2 missing (Windows) | Install from https://developer.microsoft.com/en-us/microsoft-edge/webview2/ |

**Example**

```sh
butter doctor
  Bun ................ v1.2.0
  Compiler ........... clang 16.0.0
  Webview ............ WKWebView (macOS)

  All checks passed.
```

---

### `butter bundle`

Wraps the compiled binary in a platform-native application package. You must run `butter compile` first.

**Arguments**

None. The project directory is always `process.cwd()`.

**Behavior**

The command reads `butter.yaml`, locates the compiled binary in `dist/`, and produces a native package:

| Platform | Output | Contents |
|---|---|---|
| macOS | `dist/<App Name>.app` | `.app` bundle with `Contents/MacOS/<binary>`, `Contents/Resources/` (icon if configured), and `Contents/Info.plist` |
| Linux | `dist/<App Name>.AppDir` | AppDir with `usr/bin/<binary>`, `AppRun` symlink, `.desktop` file, and icon if configured |
| Windows | `dist/<App Name>/` | Directory with `.exe` binary and icon if configured |

The `Info.plist` (macOS) and `.desktop` file (Linux) are generated from `butter.yaml`. The bundle identifier defaults to `com.example.<appname>` and the category defaults to `public.app-category.utilities` (macOS) or `Utility` (Linux). Both can be overridden in `butter.yaml` under `bundle.identifier` and `bundle.category`.

**URL scheme registration**

Custom URL schemes can be registered via `bundle.urlSchemes` in `butter.yaml`:

```yaml
bundle:
  identifier: com.mycompany.myapp
  urlSchemes:
    - myapp
```

On macOS this adds `CFBundleURLTypes` entries to the `Info.plist`. On Linux it adds `MimeType=x-scheme-handler/<scheme>` entries to the `.desktop` file.

**Example**

```sh
butter compile
butter bundle
# macOS: open dist/My\ App.app
# Linux: run appimagetool on dist/My\ App.AppDir to produce a .AppImage
```

---

### `butter sign [options]`

Code-signs the compiled binary or app bundle, and optionally submits it for notarization (macOS).

**Arguments**

None. The project directory is always `process.cwd()`.

**Platform options**

macOS:

| Flag | Default | Description |
|---|---|---|
| `--identity <id>` | `"-"` (ad-hoc) | Signing identity for `codesign`. Use your Developer ID for distribution. |
| `--entitlements <path>` | none | Path to an entitlements plist file. |
| `--notarize` | off | Submit the signed app to Apple's notary service and staple the ticket on success. |
| `--apple-id <email>` | `$APPLE_ID` | Apple ID for notarization. |
| `--team-id <id>` | `$APPLE_TEAM_ID` | Apple Developer team ID for notarization. |
| `--password <pass>` | `$APPLE_APP_PASSWORD` | App-specific password for notarization. |

Windows:

| Flag | Default | Description |
|---|---|---|
| `--pfx <path>` | none | Path to the `.pfx` certificate file. Required. |
| `--pfx-password <pass>` | none | Password for the PFX certificate. |

Linux:

| Flag | Default | Description |
|---|---|---|
| `--identity <key-id>` | default GPG key | GPG key ID to sign with. Optional; uses the default GPG key if omitted. |

**Behavior**

On macOS, the command looks for a `.app` bundle in `dist/` first, falling back to the raw binary. It runs `codesign --force --deep --sign <identity> --options runtime` and verifies the signature. If `--notarize` is passed, it zips the app, submits via `xcrun notarytool`, waits for completion, and staples the ticket with `xcrun stapler staple`.

On Windows, it invokes `signtool sign` with SHA256 digest and DigiCert timestamping.

On Linux, it creates a detached ASCII-armored GPG signature (`dist/<appname>.asc`).

**Example**

```sh
# macOS ad-hoc signing
butter sign

# macOS distribution signing with notarization
butter sign --identity "Developer ID Application: My Company" \
  --notarize --apple-id me@example.com --team-id ABCDE12345 --password @keychain:AC_PASSWORD

# Windows
butter sign --pfx cert.pfx --pfx-password secret

# Linux
butter sign --identity 0xABCDEF01
```

---

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Error (doctor failure, missing argument, project already exists, etc.) |
