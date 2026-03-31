import type { Menu } from "butter"

const menu: Menu = [
  {
    label: "File",
    items: [
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
    ],
  },
]

export default menu
