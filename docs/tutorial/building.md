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

## Distribution

The binary is self-contained and has no runtime dependencies beyond the OS webview:

- macOS: WKWebView is part of the OS. No additional libraries needed.
- Linux: Requires WebKitGTK to be installed on the user's machine. It is typically present on any desktop Linux system, but is not embedded in the binary.

### macOS

The binary runs directly:

```bash
./dist/myapp
```

For App Store distribution or signed distribution, you will need to wrap the binary in a `.app` bundle and sign it with your Developer ID. Butter does not currently automate this step.

### Linux

Users need WebKitGTK:

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel

# Arch
sudo pacman -S webkit2gtk-4.1
```

Then run:

```bash
./dist/myapp
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
