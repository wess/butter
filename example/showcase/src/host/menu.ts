import type { Menu } from "butter"

const menu: Menu = [
  {
    label: "File",
    items: [
      { label: "New Window", action: "file:new", shortcut: "CmdOrCtrl+N" },
      { separator: true },
      { label: "Open File...", action: "file:open", shortcut: "CmdOrCtrl+O" },
      { label: "Save As...", action: "file:saveas", shortcut: "CmdOrCtrl+Shift+S" },
      { separator: true },
      { label: "Quit", action: "quit", shortcut: "CmdOrCtrl+Q" },
    ],
  },
  {
    label: "Edit",
    items: [
      { label: "Undo", action: "undo", shortcut: "CmdOrCtrl+Z" },
      { label: "Redo", action: "redo", shortcut: "CmdOrCtrl+Shift+Z" },
      { separator: true },
      { label: "Cut", action: "cut", shortcut: "CmdOrCtrl+X" },
      { label: "Copy", action: "copy", shortcut: "CmdOrCtrl+C" },
      { label: "Paste", action: "paste", shortcut: "CmdOrCtrl+V" },
      { label: "Select All", action: "selectall", shortcut: "CmdOrCtrl+A" },
    ],
  },
  {
    label: "View",
    items: [
      { label: "Toggle Fullscreen", action: "view:fullscreen", shortcut: "CmdOrCtrl+Shift+F" },
      { label: "Actual Size", action: "view:actualsize", shortcut: "CmdOrCtrl+0" },
      { separator: true },
      { label: "Reload", action: "view:reload", shortcut: "CmdOrCtrl+R" },
      { label: "Developer Tools", action: "view:devtools", shortcut: "CmdOrCtrl+Alt+I" },
    ],
  },
  {
    label: "Help",
    items: [
      { label: "About Butter Showcase", action: "help:about" },
      { separator: true },
      { label: "Documentation", action: "help:docs" },
      { label: "Report Issue", action: "help:issue" },
    ],
  },
]

export default menu
