# Features — Complete

Electron/Tauri feature parity audit. All items implemented.

## Core Window Management

| Feature | macOS | Linux | Windows |
|---|---|---|---|
| Multi-window | Done | Done | Done |
| Frameless/transparent | Done | Done | Done |
| Fullscreen/maximize/minimize/restore | Done | Done | Done |
| Window positioning/sizing | Done | Done | Done |
| Always-on-top | Done | Done | Done |
| Modal windows | Done | Done | Done |
| Window events (resize, move, focus, blur) | Done | Done | Done |

## Dialogs

| Feature | macOS | Linux | Windows |
|---|---|---|---|
| File open dialog | Done | Done (GtkFileChooser) | Done (IFileOpenDialog) |
| File save dialog | Done | Done (GtkFileChooser) | Done (IFileSaveDialog) |
| Folder picker | Done | Done (GtkFileChooser) | Done (IFileOpenDialog + PICKFOLDERS) |
| Message/alert/confirm | Done (NSAlert) | Done (GtkMessageDialog) | Done (MessageBoxW) |
| Context menus | Done (NSMenu) | Done (GtkMenu) | Done (TrackPopupMenu) |

## System Integration

| Feature | macOS | Linux | Windows |
|---|---|---|---|
| System tray + menus | Done (NSStatusItem) | Done (GtkStatusIcon) | Done (Shell_NotifyIcon) |
| Global shortcuts | Done (NSEvent monitor) | Done (XGrabKey) | Done |
| Deep linking / URL schemes | Done (NSAppleEventManager) | Done (argv + .desktop) | Done (WM_COPYDATA + argv) |
| Shell integration (open URL, show in folder) | Done | Done | Done |
| Dock badge/bounce | Done (NSDockTile) | N/A | Done (taskbar) |
| Power/sleep/wake events | Done (NSWorkspace) | Done (logind DBus) | Done |
| System theme detection | Done | Done | Done |
| Secure storage / keychain | Done (security CLI) | Done (secret-tool) | Done (cmdkey) |

## Webview Features

| Feature | macOS | Linux | Windows |
|---|---|---|---|
| Navigation (back/forward/reload/loadUrl) | Done | Done | Done |
| Find in page | Done | Done | Done |
| Printing | Done | Done | Done |
| Screen capture / screenshot | Done (WKWebView snapshot) | Done (cairo) | Done (BitBlt) |
| Drag-and-drop (drop:files) | Done | Done | Done |
| Streaming IPC (sendChunk/stream) | Done | Done | Done |
| CSP headers | Done | Done | Done |

## Monitor/Display

| Feature | macOS | Linux | Windows |
|---|---|---|---|
| Multi-monitor / screen list | Done (NSScreen) | Done (GdkMonitor) | Done (EnumDisplayMonitors) |
| DPI / scale factor | Done | Done | Done (GetDpiForMonitor) |

## Plugins (20 total, all cross-platform via Bun host)

| Plugin | IPC Actions |
|---|---|
| tray | tray:set, tray:remove, tray:action |
| dialog | dialog:open, dialog:save, dialog:folder, dialog:message |
| notifications | notify:send |
| clipboard | clipboard:read, clipboard:write |
| globalshortcuts | shortcut:register, shortcut:unregister, shortcut:triggered |
| autoupdater | updater:check, updater:download, updater:install, updater:restart |
| shell | shell:openurl, shell:showinfolder, shell:openpath |
| network | network:status, network:change |
| logging | log:configure, log:write |
| crashreporter | crash:configure, crash:report, crash:list |
| i18n | i18n:init, i18n:t, i18n:locale, i18n:all |
| accessibility | a11y:announce, a11y:title, a11y:focus |
| theme | theme:get, theme:changed |
| securestorage | securestorage:set, securestorage:get, securestorage:delete |
| fs | fs:read, fs:readbinary, fs:write, fs:writebinary, fs:exists, fs:mkdir, fs:readdir, fs:remove, fs:stat |
| downloads | download:start, download:cancel, download:list, download:progress, download:complete |
| navigation | nav:back, nav:forward, nav:reload, nav:loadurl |
| dock | dock:setbadge, dock:bounce, dock:setprogress |
| findinpage | find:start, find:stop |
| lifecycle | app:getinfo, app:beforequit, app:willquit, app:activate, app:reopen |

## Security

| Feature | Status |
|---|---|
| CSP headers | Done: security.csp in butter.yaml |
| Permissions allowlist | Done: security.allowlist with pattern matching |
| Code signing (macOS) | Done: butter sign with codesign + notarytool |
| Code signing (Windows) | Done: butter sign with signtool |
| Code signing (Linux) | Done: butter sign with GPG |

## CLI Commands

| Command | Description |
|---|---|
| butter init | Scaffold new project (vanilla, react, svelte, vue) |
| butter dev | Development mode with hot reload |
| butter compile | Build single-file binary |
| butter bundle | Create .app / .AppDir package |
| butter sign | Code sign and notarize |
| butter doctor | Check platform prerequisites |

## Runtime API (22 exports)

on, send, getWindow, setWindow, createWindow, sendChunk, maximize, minimize, restore, fullscreen, setAlwaysOnTop, closeWindow, setMenu, print, screenshot, ready, listScreens
