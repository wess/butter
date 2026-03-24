import { test, expect } from "bun:test"
import type { Config, MenuItem, Menu, Plugin, WindowOptions, IpcMessage } from "../src/types"

test("Config type is usable", () => {
  const config: Config = {
    window: { title: "Test", width: 800, height: 600 },
    build: { entry: "src/app/index.html", host: "src/host/index.ts" },
  }
  expect(config.window.title).toBe("Test")
})

test("Menu type is usable", () => {
  const menu: Menu = [
    {
      label: "File",
      items: [
        { label: "Quit", action: "app:quit", shortcut: "CmdOrCtrl+Q" },
        { separator: true },
      ],
    },
  ]
  expect(menu[0].label).toBe("File")
  expect(menu[0].items).toHaveLength(2)
})

test("Plugin type is usable", () => {
  const plugin: Plugin = {
    name: "test",
    host: ({ on }) => { on("test", () => "ok") },
    webview: () => "window.butter.test = {}",
  }
  expect(plugin.name).toBe("test")
})

test("IpcMessage type is usable", () => {
  const msg: IpcMessage = {
    id: "1",
    type: "invoke",
    action: "greet",
    data: { name: "world" },
  }
  expect(msg.action).toBe("greet")
})
