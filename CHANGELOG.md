# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> The GitHub release for each tag is generated automatically (`generate_release_notes`
> in the publish workflow) and lists the raw commits for that tag. This file is the
> curated, human-readable history — prefer it for understanding what changed and why.

## [Unreleased]

## [1.6.3]

### Added

- `lint`, `format`, `check`, and `typecheck` npm scripts; Biome is now a pinned
  dev dependency instead of being pulled transiently via `bunx`.
- CI `lint + typecheck` job (Biome + `tsc --noEmit`) and an example-app build
  step that exercises `butter compile` + `butter bundle` end to end.
- Test coverage for the `package` CLI (`distAppName` sanitization, the NSIS
  installer template, and the "run bundle first" error paths).

### Fixed

- `tsc --noEmit` is now clean for the framework source: unified the
  `SharedRegion` type across the darwin/linux/win32 shared-memory backends,
  added the missing `bun:ffi` pointer casts, and guarded the undefined cases in
  the native parser/build and the `init` argument parser.
- Cleared the Biome lint errors across `src` (import protocol, template literals,
  unused imports/vars, block statements).

## [1.6.x]

### Added

- Additional plugins, window `material` (vibrancy / mica / acrylic / tabbed),
  capability declarations, and the `butter package` command (DMG / AppImage /
  NSIS or portable zip).

### Fixed

- FFI handling and shared-memory signalling hardening.

## [1.4.0]

### Added

- Stability and performance pass across compile, tray, and plugins.

## [1.3.1]

### Fixed

- Large-payload IPC frame drops, MCP session reuse, and native build robustness.

## [1.2.0] – [1.2.5]

### Added

- MCP dev server (macOS) exposing `eval_javascript`, `list_console_messages`,
  `take_screenshot`, `click`, and `fill`, wired through the runtime control
  channel.
- Console ring buffer and `runtime.tap()` for non-replacing event observation.
- `butter.yaml` parsing for the `security`, `splash`, and `dev.mcp` sections.

## [1.1.1] – [1.1.2]

### Fixed

- Compile, tray, and plugin fixes.

## [1.0.0]

### Added

- First stable release: Bun/TypeScript host, per-platform native webview shim
  (WKWebView / WebKitGTK / WebView2), shared-memory ring-buffer IPC, native FFI
  extensions (C / Moxy / Rust / Zig), and single-file binary output via
  `butter compile`.

[Unreleased]: https://github.com/wess/butter/compare/v1.6.3...HEAD
[1.6.3]: https://github.com/wess/butter/compare/v1.4.0...v1.6.3
[1.6.x]: https://github.com/wess/butter/compare/v1.4.0...v1.6.3
[1.4.0]: https://github.com/wess/butter/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/wess/butter/compare/v1.2.5...v1.3.1
[1.2.0]: https://github.com/wess/butter/compare/v1.1.2...v1.2.5
[1.1.1]: https://github.com/wess/butter/compare/v1.0.1...v1.1.2
[1.0.0]: https://github.com/wess/butter/releases/tag/v1.0.0
