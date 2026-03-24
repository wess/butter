# Menus

Butter supports native OS menus defined in TypeScript. On macOS this is the menu bar. On Linux it is a window menu bar via GTK.

## Defining a Menu

Create `src/host/menu.ts` and export a default value typed as `Menu`:

```ts
// src/host/menu.ts
import type { Menu } from "butter"

export default [
  {
    label: "File",
    items: [
      { label: "New",  action: "file:new",  shortcut: "CmdOrCtrl+N" },
      { label: "Open", action: "file:open", shortcut: "CmdOrCtrl+O" },
      { label: "Save", action: "file:save", shortcut: "CmdOrCtrl+S" },
      { separator: true },
      { label: "Quit", action: "quit",      shortcut: "CmdOrCtrl+Q" },
    ],
  },
  {
    label: "Edit",
    items: [
      { label: "Undo",  action: "undo",  shortcut: "CmdOrCtrl+Z"       },
      { label: "Redo",  action: "redo",  shortcut: "CmdOrCtrl+Shift+Z" },
      { separator: true },
      { label: "Cut",   action: "cut",   shortcut: "CmdOrCtrl+X" },
      { label: "Copy",  action: "copy",  shortcut: "CmdOrCtrl+C" },
      { label: "Paste", action: "paste", shortcut: "CmdOrCtrl+V" },
    ],
  },
] satisfies Menu
```

Butter loads `src/host/menu.ts` automatically if it exists. No import or registration is needed in your host entry point.

## Menu Structure

A `Menu` is an array of `MenuSection`. Each section has a `label` and an array of items.

An item is either:

- A menu action: `{ label, action, shortcut? }`
- A separator: `{ separator: true }`

```ts
type MenuItem =
  | { label: string; action: string; shortcut?: string }
  | { separator: true }

type MenuSection = {
  label: string
  items: MenuItem[]
}

type Menu = MenuSection[]
```

## Shortcuts

Use `CmdOrCtrl` as a cross-platform modifier. Butter resolves it to `Cmd` on macOS and `Ctrl` on Linux and Windows.

```ts
{ label: "Save", action: "file:save", shortcut: "CmdOrCtrl+S" }
// macOS:  Cmd+S
// Linux:  Ctrl+S
```

Standard modifier names:

| Name         | macOS | Linux/Windows |
|--------------|-------|---------------|
| `CmdOrCtrl`  | Cmd   | Ctrl          |
| `Shift`      | Shift | Shift         |
| `Alt`        | Option| Alt           |

Combine them with `+`:

```ts
{ label: "Redo", action: "redo", shortcut: "CmdOrCtrl+Shift+Z" }
```

## Handling Custom Actions

When a menu item is clicked, Butter sends an IPC event to your host code with the item's `action` string. Handle it with `on`:

```ts
// src/host/index.ts
import { on, send } from "butter"

on("file:new", () => {
  // Create a new document
  const doc = createDocument()
  send("document:opened", doc)
})

on("file:open", async () => {
  // Open a native file picker, return the result to the webview
  const path = await openFilePicker()
  if (path) {
    const contents = await Bun.file(path).text()
    send("document:opened", { path, contents })
  }
})

on("file:save", async (data) => {
  await Bun.write(currentPath, data as string)
  send("document:saved", { path: currentPath })
})
```

The webview listens for the resulting events:

```ts
// src/app/main.ts
butter.on("document:opened", (doc) => {
  renderDocument(doc)
})

butter.on("document:saved", ({ path }) => {
  showSavedIndicator(path)
})
```

## Built-in Actions

Some action names have special meaning and map to native OS behavior without any handler on your part:

| Action  | Behavior                                      |
|---------|-----------------------------------------------|
| `quit`  | Closes the window and exits the app           |
| `undo`  | Native undo (text fields, webview edit state) |
| `redo`  | Native redo                                   |
| `cut`   | Native cut                                    |
| `copy`  | Native copy                                   |
| `paste` | Native paste                                  |

You can still add your own `on("undo", ...)` handler if you want to intercept the action in host code.

## macOS App Menu

On macOS, the system automatically prepends an app menu (the leftmost menu with your app's name). It includes standard items like About, Hide, and Quit. Butter populates the app name from your `butter.yaml` title.

You do not need to define this menu yourself.

## Example: A Full Text Editor Menu

```ts
// src/host/menu.ts
import type { Menu } from "butter"

export default [
  {
    label: "File",
    items: [
      { label: "New",             action: "file:new",      shortcut: "CmdOrCtrl+N"       },
      { label: "Open...",         action: "file:open",     shortcut: "CmdOrCtrl+O"       },
      { separator: true },
      { label: "Save",            action: "file:save",     shortcut: "CmdOrCtrl+S"       },
      { label: "Save As...",      action: "file:saveas",   shortcut: "CmdOrCtrl+Shift+S" },
      { separator: true },
      { label: "Quit",            action: "quit",          shortcut: "CmdOrCtrl+Q"       },
    ],
  },
  {
    label: "Edit",
    items: [
      { label: "Undo",            action: "undo",          shortcut: "CmdOrCtrl+Z"       },
      { label: "Redo",            action: "redo",          shortcut: "CmdOrCtrl+Shift+Z" },
      { separator: true },
      { label: "Cut",             action: "cut",           shortcut: "CmdOrCtrl+X"       },
      { label: "Copy",            action: "copy",          shortcut: "CmdOrCtrl+C"       },
      { label: "Paste",           action: "paste",         shortcut: "CmdOrCtrl+V"       },
      { separator: true },
      { label: "Find...",         action: "edit:find",     shortcut: "CmdOrCtrl+F"       },
    ],
  },
  {
    label: "View",
    items: [
      { label: "Toggle Sidebar",  action: "view:sidebar",  shortcut: "CmdOrCtrl+B"       },
      { label: "Toggle Fullscreen", action: "view:fullscreen", shortcut: "CmdOrCtrl+Shift+F" },
    ],
  },
] satisfies Menu
```

Then handle the custom actions:

```ts
// src/host/index.ts
import { on, send } from "butter"

on("file:new", () => {
  send("document:new", null)
})

on("edit:find", () => {
  send("ui:show-find", null)
})

on("view:sidebar", () => {
  send("ui:toggle-sidebar", null)
})

on("view:fullscreen", () => {
  send("ui:toggle-fullscreen", null)
})
```
