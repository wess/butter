import { test, expect } from "bun:test"
import { resolveShortcut, serializeMenu } from "../src/menu"
import type { Menu } from "../src/types"

test("resolveShortcut maps CmdOrCtrl per platform", () => {
  const mac = resolveShortcut("CmdOrCtrl+N", "darwin")
  expect(mac).toBe("Cmd+N")

  const linux = resolveShortcut("CmdOrCtrl+N", "linux")
  expect(linux).toBe("Ctrl+N")

  const win = resolveShortcut("CmdOrCtrl+N", "win32")
  expect(win).toBe("Ctrl+N")
})

test("resolveShortcut passes through non-CmdOrCtrl shortcuts", () => {
  expect(resolveShortcut("Alt+F4", "win32")).toBe("Alt+F4")
})

test("serializeMenu produces JSON with resolved shortcuts", () => {
  const menu: Menu = [
    {
      label: "File",
      items: [
        { label: "New", action: "file:new", shortcut: "CmdOrCtrl+N" },
        { separator: true },
        { label: "Quit", action: "app:quit", shortcut: "CmdOrCtrl+Q" },
      ],
    },
  ]
  const json = serializeMenu(menu, "darwin")
  const parsed = JSON.parse(json)
  expect(parsed[0].items[0].shortcut).toBe("Cmd+N")
  expect(parsed[0].items[1]).toEqual({ separator: true })
})
