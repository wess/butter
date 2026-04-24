# Embedded Browser Engine (Concept Exploration)

Status: **exploratory — no decision made.** This document captures the April 2026 discussion about whether Butter could ship an embedded rendering engine alongside (or instead of) the system webviews it uses today. It is kept for future reference when revisiting the question.

---

## The question

Butter today uses the platform's system webview on each OS: `WKWebView` on macOS, `WebView2` on Windows, `WebKitGTK` on Linux. This keeps the binary small and the app feeling native, but the engine version, web-platform coverage, and update cadence are out of our hands and differ per user machine.

The question: what would it look like to ship an embedded engine, the way Electron ships Chromium — but *without* using Chromium-as-Google's-product?

Two hard constraints shaped the discussion:

1. The engine must be **completely free** (no commercial licensing).
2. Butter should be **as independent from Google as possible**.

---

## Option survey

### Ultralight
Rejected. Proprietary, commercial licensing required for anything beyond indie/non-commercial use. Fails constraint #1.

### Gecko (Firefox's engine)
Rejected after examination. In principle MPL-2.0 and ideologically aligned. In practice the desktop embedding story is **dead**:

- `GeckoView` is the only maintained Gecko embedding library, and it is **Android-only**.
- Positron (Mozilla's Electron-compatible Gecko runtime) was **discontinued in 2017**. Its successor `qbrt` also went nowhere.
- XULRunner / GRE / Gecko SDK were killed around 2015.
- No stable C/C++ embedding ABI exists. Gecko's XPCOM internals churn every Firefox release and are designed for Firefox itself.

The only paths left — bundling and driving a full Firefox runtime, or maintaining a private fork against Gecko internals — are not reasonable for Butter.

### Servo
Viable long-term, not yet viable today.

- MPL-2.0, now under Linux Foundation Europe, actively developed.
- `libservo` crate exposes a handle-based `WebView` API with `WebViewDelegate` / `ServoDelegate` traits and `evaluate_javascript()`. Reference embedder is `servoshell`; `Verso` is the most active real-world embedder, proving the pattern works.
- All desktop platforms supported (macOS, Windows, Linux).
- Current version ~0.1.0 (pre-alpha). First alpha targeted Summer 2026 on Linux/macOS.
- Web-platform coverage has real gaps: media codecs, WebGL2 edge cases, Service Workers, WebRTC, IndexedDB corners, various CSS features.
- API churn expected through 2026 as embedding surface stabilizes.

### CEF + vanilla Chromium
Mature and easy. The standard embedding path — CEF is BSD-licensed, not a Google project, and Spotify hosts prebuilt binaries. But you still ship Google's Chromium. Google services can be disabled at runtime via flags, but the code paths remain in the binary. Acceptable if "doesn't phone home" is enough, but weak on constraint #2.

### CEF + ungoogled-chromium (recommended path if going this route)
The serious answer to "Chromium without Google":

- CEF is Chromium Embedded Framework — an embedding library, not a Google project.
- [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium) is a patch set that removes Google runtime integrations at the source level (Safe Browsing, Google Update, UMA metrics, translate, sync, Widevine defaults, DNS-over-HTTPS defaults pointing at Google, web store, crash reporting, etc.).
- CEF applies patches to Chromium during build; ungoogled also applies patches. Stacking them is documented but non-trivial — some patches conflict and need manual reconciliation.
- No prebuilt "ungoogled CEF" distribution exists; you build it yourself.

---

## Two kinds of "Google in it"

This distinction matters for deciding how far to go.

**Runtime Google (strippable).** Safe Browsing, Google Update, UMA/metrics, crash reporting, translate, sync, web store, DoH-over-Google, Widevine defaults. Ungoogled-chromium removes these at source level. With the right runtime flags on top, nothing leaves the machine to Google.

**Structural Google (not strippable).** Blink, V8, Chromium's architecture, the project's direction. Google writes ~90% of the code. Using Chromium means accepting this ceiling. The only way to escape is to use Servo.

If the bar is "nothing leaves my machine to Google, and no Google binaries in the bundle" → CEF + ungoogled achieves it. If the bar is "zero Google influence, ever" → only Servo clears it.

---

## Butter's webview integration surface (baseline)

Butter is unusually well-positioned for a renderer swap because the webview lives in a **separate shim process** with a clean IPC wall between it and Bun. The current surface:

| Concern | Current implementation | File |
|---|---|---|
| Shim (per platform) | WKWebView (Obj-C) / WebView2 (C) / WebKitGTK (C) | `src/shim/darwin.m`, `src/shim/windows.c`, `src/shim/linux.c` |
| Native window | NSWindow / HWND / GtkWindow | (same files) |
| IPC to Bun | 128 KB shared-memory ring buffer + platform semaphores | `src/ipc/shmem.ts`, `src/ipc/protocol.ts`, `src/ipc/native/semhelper.c` |
| Custom `butter://` scheme | `WKURLSchemeHandler` / `SetVirtualHostNameToFolderMapping` / `webkit_web_context_register_uri_scheme_request_callback` | per-platform shim |
| Bridge script | Inline JS injected before page load, exposes `window.butter.{invoke,stream,on,off,contextMenu}` | `src/shim/bridge.js` |
| Plugins (23) | Bun-side only, respond to `invoke` RPCs over IPC | `src/plugins/*` |

**Critical property:** everything above the shim (Bun runtime, IPC protocol, plugin system, JS bridge API surface) is renderer-agnostic. A different engine is a *shim-replacement* job, not a framework rewrite. The 23 plugins do not need to change.

---

## Integration: Servo

### Shim map

| Butter piece | Today | Servo backend |
|---|---|---|
| Shim language | C / Obj-C per platform | Single Rust binary (libservo + winit) |
| Native window | NSWindow / HWND / GtkWindow | `winit` window, Servo renders into its surface |
| Webview instance | System webview | `servo::WebView` handle |
| IPC ring buffer | C code against shmem | Rust FFI to same shmem + sem helpers — **protocol unchanged** |
| Host→webview JS | `evaluateJavaScript` etc. | `WebView::evaluate_javascript()` |
| Webview→host message | `webkit.messageHandlers` etc. | Custom in `bridge.js`: route via `butter://__ipc__/...` intercepted by protocol handler, or console-message channel via `WebViewDelegate` |
| `butter://` scheme | 3 platform-specific handlers | One Rust `ProtocolHandler` |
| `bridge.js` injection | Inline before page load | `evaluate_javascript` on `load_start` delegate callback |
| Plugins | Bun-side | **Unchanged** |
| Bun runtime | unchanged | unchanged |

### Work required

1. New Rust crate `src/shim-servo/` — replaces the three C/Obj-C shims with a single Rust binary. Estimated 2–5k LOC: winit event loop, Servo setup, delegate impls, custom protocol handler, bridge injection, shmem FFI client.
2. Compile-time backend switch in `src/shim/index.ts` and `src/cli/compile.ts` to embed the correct shim.
3. `bridge.js` tweak — replace the macOS-specific `webkit.messageHandlers` path with a scheme-based channel that works uniformly on Servo.
4. Plugins: zero changes.

### Costs and risks

- **Binary size blows up 10–30×.** Current artifact ~30–50 MB on macOS. Servo shim adds ~80–150 MB. Net: ~150–200 MB per app.
- **Pre-alpha engine.** Real web platform gaps. A non-trivial app will hit missing features that work in WKWebView.
- **API churn.** libservo's embedding surface is still reshaping through 2026.
- **Native UX regressions.** Loses native scroll physics, spellcheck, context menus, OS accessibility integration, "looks like a Mac app" feel. `winit` windows are functional but generic.
- **No native DevTools.** Partial remote DevTools, nothing comparable to Safari Web Inspector or Edge DevTools.

---

## Integration: CEF + ungoogled-chromium

### Architectural note

CEF is **multi-process by design**: one browser process (owns the window) + one renderer process per browser + GPU/utility processes. For Butter:

- The shim becomes the CEF **browser process** — owns the native window, talks to Bun over the existing ring buffer.
- Blink + V8 run in a **separate renderer process** that CEF manages.
- `window.butter` must be installed in the **renderer** (V8 context), not the browser process, and forwarded to the browser process via `CefProcessMessage`, which then forwards to Bun over the ring buffer. One extra hop compared to today.

CEF manages the renderer-process lifecycle; the implementer just provides callbacks on both sides.

### Shim map

| Butter piece | Today | CEF backend |
|---|---|---|
| Shim language | C / Obj-C / C per platform | **Single C++ codebase** (CEF is cross-platform) |
| Native window | NSWindow / HWND / GtkWindow | CEF creates it, or accepts a native handle |
| Webview | WKWebView / WebView2 / WebKitGTK | `CefBrowser` |
| `butter://` scheme | 3 platform-specific handlers | `CefApp::OnRegisterCustomSchemes` + `CefSchemeHandlerFactory` — one implementation, all platforms |
| Bridge injection | Inline JS before page load | `CefRenderProcessHandler::OnContextCreated` in renderer (sets up `window.butter`), or load-time script injection |
| Webview→host message | `webkit.messageHandlers` etc. | `CefProcessMessage` from renderer → browser process → Bun via ring buffer |
| Host→webview | `evaluateJavaScript` etc. | `CefFrame::ExecuteJavaScript` |
| IPC to Bun | Ring buffer | Unchanged |
| Plugins | Bun-side | Unchanged |
| DevTools | System devtools | Chrome DevTools **for free** |

**Net shim code estimate:** 3–6k LOC of C++. Actually *less* total shim code than today, because CEF abstracts the platform for us.

### The real cost: the build pipeline

This is the biggest lift, bigger than the shim code.

1. **Source setup** — `depot_tools`, `fetch chromium`, ~100 GB disk, multi-hour checkout.
2. **Patch stack** — apply ungoogled-chromium's patch series, then CEF's patch series on top. Expect 5–20 conflicts to resolve manually per Chromium version bump.
3. **Build** — `autoninja -C out/Release cef`. 4–12 hours on a beefy machine, 32+ GB RAM recommended.
4. **Package** — CEF produces a `Release/` directory (~400 MB unpacked, ~150–200 MB packed into the app).
5. **Matrix** — macOS (arm64, x64), Windows (x64, arm64), Linux (x64, arm64). CI with large runners or a build farm is required.
6. **Cadence** — upstream Chromium ships every ~4 weeks; security-critical CVEs need faster turnaround. Ungoogled-chromium lags upstream by 1–3 weeks. Follow or fall behind on security fixes.

### Recommended phasing

1. **Phase 1 — validate architecture with vanilla CEF prebuilts.** Use Spotify's prebuilt CEF binaries (`cef-builds.spotifycdn.com`) to build the new C++ shim, prove the IPC wiring, the `butter://` handler, the `window.butter` bridge. No build farm needed. Google services disabled via runtime flags (below) rather than source-stripped.
2. **Phase 2 — swap in ungoogled build.** Stand up a build pipeline. Start from ungoogled-chromium's patch set + CEF's patch set. Automate the rebase-and-rebuild loop per Chromium release.
3. **Phase 3 — ship as a backend option.** `butter build --renderer=chromium-ungoogled` alongside the system-webview default and (later) `--renderer=servo`.

### Runtime flags (belt-and-braces for phase 1 and phase 2)

Pass to `CefSettings` / command line so nothing sneaks through even in ungoogled builds:

```
--disable-background-networking
--disable-component-update
--disable-domain-reliability
--disable-sync
--disable-breakpad
--disable-features=Translate,OptimizationHints,MediaRouter,InterestFeedContentSuggestions
--no-pings
--safebrowsing-disable-auto-update
--metrics-recording-only=false
```

---

## Side-by-side comparison

| Aspect | System webviews (today) | Servo | CEF + ungoogled |
|---|---|---|---|
| License | free | MPL-2.0 | BSD (CEF) + BSD (Chromium) |
| Binary size per app | ~30–50 MB | ~150–200 MB | ~150–200 MB |
| Memory footprint | low (shared with OS) | one engine per app | one browser proc + one renderer proc + GPU proc per app — **highest** |
| Web platform coverage | platform-dependent, generally good | pre-alpha, gaps | complete |
| Runtime independence from Google | full | full | ~100% with ungoogled + flags |
| Structural independence from Google | full | full | none — Blink/V8 are Google |
| Maturity today | production | pre-alpha | production |
| Build pipeline | none | medium (track libservo) | **high** (track Chromium + patch stack) |
| DevTools | platform native | limited | Chrome DevTools |
| Native UX feel | native | generic (winit) | native (CEF uses platform windows) |
| Risk of upstream pulling the rug | OS-version dependent | low | low but non-zero (Google steers Chromium) |

---

## Open concerns (the reasons this is not yet a decision)

- **Memory usage.** Chromium's multi-process model is the biggest operational change. Today a Butter app is Bun + shim — two processes, system webview shared with the OS. With CEF: Bun + CEF browser process + renderer process(es) + GPU process + utility processes, each with its own heap. Per-app RAM footprint jumps dramatically. Running five Butter apps on a laptop is a very different experience.
- **Binary size.** ~150–200 MB per app (either engine) versus ~30–50 MB today. Multiply across installed apps.
- **Build pipeline ownership.** CEF + ungoogled requires a sustained ops investment: large CI runners, patch rebases, CVE fast-track builds. That is a maintenance load Butter does not carry today.
- **Web-platform drift.** With Servo, we accept missing features. With ungoogled, we accept ongoing Google influence on the web-platform direction — ungoogled removes Google's *services*, not Google's *control* over Blink.
- **User expectations.** System webviews integrate with OS spellcheck, accessibility, context menus, autofill, password managers. Embedded engines lose much of this by default and must reimplement what matters.
- **Why are we doing this at all?** The constraints driving this question (consistency across platforms? specific web features not available in a system webview? ideological independence?) are not yet pinned down. The right choice depends on which of those is actually load-bearing.

---

## Recommendation captured from the discussion

If the question becomes "do it" rather than "should we":

1. **Keep system webviews as the default.** They are what gives Butter its small-binary, native-feel story. Any embedded engine is an *alternative backend* behind a flag, not a replacement.
2. **CEF + ungoogled-chromium is the right target today** for "embedded, complete web platform, maximum runtime independence from Google."
3. **Servo is the right target medium-term** for "embedded, structural independence from Google" — but defer until after its Summer 2026 alpha.
4. **Phase 1 is free.** Validate the C++ shim architecture against vanilla CEF prebuilts before committing to the ungoogled build pipeline.

No decision is being made in this document. It exists so that when the question comes back up, the survey, tradeoffs, and integration map do not have to be reconstructed from scratch.

---

## References

- [Servo — libservo embedding API](https://servo.org/)
- [Verso — real-world Servo embedder](https://github.com/versotile-org/verso/)
- [Servo embedding example](https://github.com/paulrouget/servo-embedding-example)
- [CEF on GitHub](https://github.com/chromiumembedded/cef)
- [CEF general usage](https://chromiumembedded.github.io/cef/general_usage.html)
- [CEF prebuilt binaries](https://cef-builds.spotifycdn.com/index.html)
- [CEF forum: building CEF against ungoogled-chromium](https://www.magpcss.org/ceforum/viewtopic.php?f=6&t=19804)
- [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium)
- [Positron discontinued (Mozilla, 2017)](https://mykzilla.org/2017/03/08/positron-discontinued/)
- [GeckoView (Android only)](https://mozilla.github.io/geckoview/)
