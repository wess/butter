# Building

`butter compile` produces a single self-contained binary. Ship one file — no installers, no bundled directories, no runtime dependencies for the user.

## How It Works

The compilation process:

1. Runs `butter doctor` to verify prerequisites
2. Compiles the native shim (C/ObjC) if needed — cached after the first build
3. Bundles your frontend assets with Bun's bundler, minified
4. Inlines all JS and CSS into the HTML (WKWebView loads HTML from a file: URL; external module scripts fail due to CORS)
5. Embeds the shim binary and all assets as base64 in a generated bootstrap script
6. Compiles the bootstrap with `bun build --compile` to produce a single executable

At runtime the binary extracts the shim and assets to a temp directory, creates the shared memory region, and starts the window.

## Running a Build

From your project directory:

```bash
bun run build
# or directly:
butter compile
```

Output:

```
Compiling "My App"...
  Compiling native shim...
  Bundling app assets...
  Generating bootstrap...
  Compiling binary...

  Binary: dist/myapp
  Size:   62.4 MB
```

The binary is written to `dist/<appname>`. The app name is derived from your `butter.yaml` title, lowercased with non-alphanumeric characters removed.

## Binary Size

The binary is around 60MB. Most of that is the Bun runtime, which is embedded by `bun build --compile`. The Bun runtime is fixed overhead regardless of your app size.

Your app code, assets, and the native shim add a few hundred KB on top.

## Bundling

After compilation, `butter bundle` wraps the standalone binary in a platform-native application package. This is the step that turns a raw executable into something users expect to see on their OS.

```bash
butter bundle
```

### macOS

On macOS, `butter bundle` creates a `.app` bundle in `dist/`:

```
dist/My App.app/
  Contents/
    Info.plist
    MacOS/
      myapp          # the compiled binary
    Resources/
      icon.icns      # if window.icon is set in butter.yaml
```

The generated `Info.plist` includes the app name, bundle identifier, version, and category. If you have configured `bundle.urlSchemes` in `butter.yaml`, the plist will include `CFBundleURLTypes` entries so the OS routes those URLs to your app.

### Linux

On Linux, `butter bundle` creates an AppDir:

```
dist/My App.AppDir/
  AppRun              # symlink to usr/bin/<binary>
  usr/bin/myapp       # the compiled binary
  myapp.desktop       # freedesktop .desktop entry
  icon.png            # if window.icon is set in butter.yaml
```

The AppDir is not directly distributable as-is. To produce a `.AppImage`, run `appimagetool` on the directory:

```bash
appimagetool "dist/My App.AppDir"
```

### URL scheme registration

To register custom URL schemes, add `bundle.urlSchemes` to `butter.yaml`:

```yaml
bundle:
  identifier: com.mycompany.myapp
  urlSchemes:
    - myapp
```

After bundling, `myapp://` URLs will open your application on both macOS and Linux.

## Code Signing

`butter sign` handles code signing for each platform. It operates on whatever is in `dist/` -- preferring the `.app` bundle on macOS, falling back to the raw binary.

### macOS

Ad-hoc signing (good enough for local testing):

```bash
butter sign
```

For distribution, sign with your Developer ID and notarize:

```bash
butter sign \
  --identity "Developer ID Application: My Company (ABCDE12345)" \
  --entitlements entitlements.plist \
  --notarize \
  --apple-id me@example.com \
  --team-id ABCDE12345 \
  --password @keychain:AC_PASSWORD
```

The notarization flags (`--apple-id`, `--team-id`, `--password`) can also be provided as environment variables `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_PASSWORD` respectively. When `--notarize` is passed, Butter zips the `.app`, submits it to Apple's notary service via `xcrun notarytool`, waits for the result, and staples the ticket on success.

### Windows

```bash
butter sign --pfx certificate.pfx --pfx-password secret
```

This invokes `signtool` with SHA256 and DigiCert timestamping.

### Linux

```bash
butter sign
# or with a specific GPG key:
butter sign --identity 0xABCDEF01
```

This creates a detached signature at `dist/<appname>.asc` using `gpg --detach-sign --armor`.

## Distribution

The full workflow from source to distributable artifact:

```bash
# 1. Compile the standalone binary
butter compile

# 2. Wrap it in a native app package
butter bundle

# 3. Code sign (and notarize on macOS)
butter sign --identity "Developer ID Application: ..." --notarize ...

# 4. Distribute
#    macOS: ship the .app (in a .dmg or .zip)
#    Linux: run appimagetool on the .AppDir, then distribute the .AppImage
#    Windows: ship the signed .exe (in an installer or .zip)
```

Each step depends on the previous one. `butter bundle` requires the compiled binary from `butter compile`. `butter sign` operates on the bundle (or binary) produced by the earlier steps.

### Runtime dependencies

The binary is self-contained except for the OS webview:

- macOS: WKWebView is part of the OS. No additional libraries needed.
- Linux: Requires WebKitGTK to be installed on the user's machine. It is typically present on any desktop Linux system, but is not embedded in the binary.

Linux users need WebKitGTK:

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel

# Arch
sudo pacman -S webkit2gtk-4.1
```

## Development vs. Production Builds

In `butter dev`, assets are not minified and source maps are inlined. In `butter compile`, Bun's bundler runs with `minify: true` and no source maps.

There is no separate configuration for this. The behavior is determined by which command you run.

## Intermediary Files

The compilation process creates files under `.butter/`:

```
.butter/
  shim            # Compiled native shim binary
  build/          # Bundled frontend assets
  buttermodule.ts # Internal butter module shim
  hostwrapper.ts  # Generated wrapper for host code
  bootstrap.ts    # Generated bootstrap script
```

These are generated and can be deleted safely. They are regenerated on the next build. Add `.butter/` to your `.gitignore`.

## Verifying Before Distribution

Run `butter doctor` before building to confirm prerequisites are in order:

```bash
butter doctor
```

A failing doctor check will also abort `butter compile` with a clear message.
