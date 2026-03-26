import { test, expect, describe } from "bun:test"
import type { HostContext, Plugin } from "../src/types"

import tray from "../src/plugins/tray"
import dialog from "../src/plugins/dialog"
import notifications from "../src/plugins/notifications"
import clipboard from "../src/plugins/clipboard"
import globalshortcuts from "../src/plugins/globalshortcuts"
import autoupdater from "../src/plugins/autoupdater"
import shell from "../src/plugins/shell"
import network from "../src/plugins/network"
import logging from "../src/plugins/logging"
import crashreporter from "../src/plugins/crashreporter"
import i18n from "../src/plugins/i18n"
import accessibility from "../src/plugins/accessibility"
import theme from "../src/plugins/theme"
import securestorage from "../src/plugins/securestorage"
import fs from "../src/plugins/fs"
import downloads from "../src/plugins/downloads"
import navigation from "../src/plugins/navigation"
import dock from "../src/plugins/dock"
import findinpage from "../src/plugins/findinpage"
import lifecycle from "../src/plugins/lifecycle"

const allPlugins: Plugin[] = [
  tray,
  dialog,
  notifications,
  clipboard,
  globalshortcuts,
  autoupdater,
  shell,
  network,
  logging,
  crashreporter,
  i18n,
  accessibility,
  theme,
  securestorage,
  fs,
  downloads,
  navigation,
  dock,
  findinpage,
  lifecycle,
]

const expectedNames = [
  "tray",
  "dialog",
  "notifications",
  "clipboard",
  "globalshortcuts",
  "autoupdater",
  "shell",
  "network",
  "logging",
  "crashreporter",
  "i18n",
  "accessibility",
  "theme",
  "securestorage",
  "fs",
  "downloads",
  "navigation",
  "dock",
  "findinpage",
  "lifecycle",
]

const createMockContext = (): HostContext & { handlers: Map<string, Function>; sent: { action: string; data: unknown }[] } => {
  const handlers = new Map<string, Function>()
  const sent: { action: string; data: unknown }[] = []
  return {
    on: (action: string, handler: (data: unknown) => unknown) => {
      handlers.set(action, handler)
    },
    send: (action: string, data: unknown) => {
      sent.push({ action, data })
    },
    handlers,
    sent,
  }
}

describe("all 20 plugins are exported", () => {
  test("there are exactly 20 plugins", () => {
    expect(allPlugins).toHaveLength(20)
  })

  test("all expected plugin names are present", () => {
    const names = allPlugins.map((p) => p.name)
    for (const expected of expectedNames) {
      expect(names).toContain(expected)
    }
  })
})

describe("plugin structure", () => {
  for (const plugin of allPlugins) {
    describe(plugin.name, () => {
      test("has a name string", () => {
        expect(typeof plugin.name).toBe("string")
        expect(plugin.name.length).toBeGreaterThan(0)
      })

      test("has a host function", () => {
        expect(typeof plugin.host).toBe("function")
      })

      test("has a webview function", () => {
        expect(typeof plugin.webview).toBe("function")
      })

      test("webview() returns a string containing window.butter", () => {
        const js = plugin.webview()
        expect(typeof js).toBe("string")
        expect(js).toContain("window.butter")
      })

      test("webview() returns a self-executing function", () => {
        const js = plugin.webview()
        expect(js).toContain("(function")
      })

      test("host() can be called with a mock context without throwing", () => {
        const ctx = createMockContext()
        expect(() => plugin.host(ctx)).not.toThrow()
      })

      test("host() registers at least one handler", () => {
        const ctx = createMockContext()
        plugin.host(ctx)
        expect(ctx.handlers.size).toBeGreaterThanOrEqual(1)
      })
    })
  }
})

describe("plugin handler registration", () => {
  test("tray registers tray:set and tray:remove", () => {
    const ctx = createMockContext()
    tray.host(ctx)
    expect(ctx.handlers.has("tray:set")).toBe(true)
    expect(ctx.handlers.has("tray:remove")).toBe(true)
  })

  test("dialog registers dialog:open and dialog:save", () => {
    const ctx = createMockContext()
    dialog.host(ctx)
    expect(ctx.handlers.has("dialog:open")).toBe(true)
    expect(ctx.handlers.has("dialog:save")).toBe(true)
  })

  test("clipboard registers clipboard:read and clipboard:write", () => {
    const ctx = createMockContext()
    clipboard.host(ctx)
    expect(ctx.handlers.has("clipboard:read")).toBe(true)
    expect(ctx.handlers.has("clipboard:write")).toBe(true)
  })

  test("notifications registers notify:send", () => {
    const ctx = createMockContext()
    notifications.host(ctx)
    expect(ctx.handlers.has("notify:send")).toBe(true)
  })

  test("globalshortcuts registers shortcut:register, shortcut:unregister, shortcut:triggered", () => {
    const ctx = createMockContext()
    globalshortcuts.host(ctx)
    expect(ctx.handlers.has("shortcut:register")).toBe(true)
    expect(ctx.handlers.has("shortcut:unregister")).toBe(true)
    expect(ctx.handlers.has("shortcut:triggered")).toBe(true)
  })

  test("autoupdater registers updater:check, updater:download, updater:install, updater:restart", () => {
    const ctx = createMockContext()
    autoupdater.host(ctx)
    expect(ctx.handlers.has("updater:check")).toBe(true)
    expect(ctx.handlers.has("updater:download")).toBe(true)
    expect(ctx.handlers.has("updater:install")).toBe(true)
    expect(ctx.handlers.has("updater:restart")).toBe(true)
  })

  test("shell registers shell:openurl, shell:showinfolder, shell:openpath", () => {
    const ctx = createMockContext()
    shell.host(ctx)
    expect(ctx.handlers.has("shell:openurl")).toBe(true)
    expect(ctx.handlers.has("shell:showinfolder")).toBe(true)
    expect(ctx.handlers.has("shell:openpath")).toBe(true)
  })

  test("network registers network:status", () => {
    const ctx = createMockContext()
    network.host(ctx)
    expect(ctx.handlers.has("network:status")).toBe(true)
  })

  test("logging registers log:configure and log:write", () => {
    const ctx = createMockContext()
    logging.host(ctx)
    expect(ctx.handlers.has("log:configure")).toBe(true)
    expect(ctx.handlers.has("log:write")).toBe(true)
  })

  test("crashreporter registers crash:configure, crash:report, crash:list", () => {
    const ctx = createMockContext()
    crashreporter.host(ctx)
    expect(ctx.handlers.has("crash:configure")).toBe(true)
    expect(ctx.handlers.has("crash:report")).toBe(true)
    expect(ctx.handlers.has("crash:list")).toBe(true)
  })

  test("i18n registers i18n:init, i18n:t, i18n:locale, i18n:all", () => {
    const ctx = createMockContext()
    i18n.host(ctx)
    expect(ctx.handlers.has("i18n:init")).toBe(true)
    expect(ctx.handlers.has("i18n:t")).toBe(true)
    expect(ctx.handlers.has("i18n:locale")).toBe(true)
    expect(ctx.handlers.has("i18n:all")).toBe(true)
  })

  test("accessibility registers a11y:announce, a11y:title, a11y:focus", () => {
    const ctx = createMockContext()
    accessibility.host(ctx)
    expect(ctx.handlers.has("a11y:announce")).toBe(true)
    expect(ctx.handlers.has("a11y:title")).toBe(true)
    expect(ctx.handlers.has("a11y:focus")).toBe(true)
  })

  test("theme registers theme:get", () => {
    const ctx = createMockContext()
    theme.host(ctx)
    expect(ctx.handlers.has("theme:get")).toBe(true)
  })

  test("securestorage registers securestorage:set, securestorage:get, securestorage:delete", () => {
    const ctx = createMockContext()
    securestorage.host(ctx)
    expect(ctx.handlers.has("securestorage:set")).toBe(true)
    expect(ctx.handlers.has("securestorage:get")).toBe(true)
    expect(ctx.handlers.has("securestorage:delete")).toBe(true)
  })

  test("fs registers multiple fs handlers", () => {
    const ctx = createMockContext()
    fs.host(ctx)
    const expected = ["fs:read", "fs:readbinary", "fs:write", "fs:writebinary", "fs:exists", "fs:mkdir", "fs:readdir", "fs:remove", "fs:stat"]
    for (const action of expected) {
      expect(ctx.handlers.has(action)).toBe(true)
    }
  })

  test("downloads registers download:start, download:cancel, download:list", () => {
    const ctx = createMockContext()
    downloads.host(ctx)
    expect(ctx.handlers.has("download:start")).toBe(true)
    expect(ctx.handlers.has("download:cancel")).toBe(true)
    expect(ctx.handlers.has("download:list")).toBe(true)
  })

  test("navigation registers nav:back, nav:forward, nav:reload, nav:loadurl", () => {
    const ctx = createMockContext()
    navigation.host(ctx)
    expect(ctx.handlers.has("nav:back")).toBe(true)
    expect(ctx.handlers.has("nav:forward")).toBe(true)
    expect(ctx.handlers.has("nav:reload")).toBe(true)
    expect(ctx.handlers.has("nav:loadurl")).toBe(true)
  })

  test("dock registers dock:setbadge, dock:bounce, dock:setprogress", () => {
    const ctx = createMockContext()
    dock.host(ctx)
    expect(ctx.handlers.has("dock:setbadge")).toBe(true)
    expect(ctx.handlers.has("dock:bounce")).toBe(true)
    expect(ctx.handlers.has("dock:setprogress")).toBe(true)
  })

  test("findinpage registers find:start and find:stop", () => {
    const ctx = createMockContext()
    findinpage.host(ctx)
    expect(ctx.handlers.has("find:start")).toBe(true)
    expect(ctx.handlers.has("find:stop")).toBe(true)
  })

  test("lifecycle registers app:getinfo, app:activate, app:reopen", () => {
    const ctx = createMockContext()
    lifecycle.host(ctx)
    expect(ctx.handlers.has("app:getinfo")).toBe(true)
    expect(ctx.handlers.has("app:activate")).toBe(true)
    expect(ctx.handlers.has("app:reopen")).toBe(true)
  })
})

describe("plugin handler behavior with mock context", () => {
  test("tray:set returns ok", () => {
    const ctx = createMockContext()
    tray.host(ctx)
    const handler = ctx.handlers.get("tray:set")!
    const result = handler({ title: "My App", items: [] }) as any
    expect(result.ok).toBe(true)
  })

  test("tray:remove returns ok", () => {
    const ctx = createMockContext()
    tray.host(ctx)
    const handler = ctx.handlers.get("tray:remove")!
    const result = handler(null) as any
    expect(result.ok).toBe(true)
  })

  test("notifications handler rejects missing title/body", async () => {
    const ctx = createMockContext()
    notifications.host(ctx)
    const handler = ctx.handlers.get("notify:send")!
    const result = await handler({}) as any
    expect(result.ok).toBe(false)
    expect(result.error).toContain("required")
  })

  test("globalshortcuts:register rejects missing id", () => {
    const ctx = createMockContext()
    globalshortcuts.host(ctx)
    const handler = ctx.handlers.get("shortcut:register")!
    const result = handler({}) as any
    expect(result.ok).toBe(false)
  })

  test("globalshortcuts:register succeeds with valid data", () => {
    const ctx = createMockContext()
    globalshortcuts.host(ctx)
    const handler = ctx.handlers.get("shortcut:register")!
    const result = handler({ id: "test", shortcut: { key: "a" } }) as any
    expect(result.ok).toBe(true)
  })

  test("globalshortcuts:unregister rejects missing id", () => {
    const ctx = createMockContext()
    globalshortcuts.host(ctx)
    const handler = ctx.handlers.get("shortcut:unregister")!
    const result = handler({}) as any
    expect(result.ok).toBe(false)
  })

  test("logging log:write rejects missing level", () => {
    const ctx = createMockContext()
    logging.host(ctx)
    const handler = ctx.handlers.get("log:write")!
    const result = handler({}) as any
    expect(result.ok).toBe(false)
    expect(result.error).toContain("required")
  })

  test("logging log:write succeeds with valid entry", () => {
    const ctx = createMockContext()
    logging.host(ctx)
    const handler = ctx.handlers.get("log:write")!
    const result = handler({ level: "info", message: "test message" }) as any
    expect(result.ok).toBe(true)
  })

  test("logging log:configure succeeds", () => {
    const ctx = createMockContext()
    logging.host(ctx)
    const handler = ctx.handlers.get("log:configure")!
    const result = handler({ level: "debug" }) as any
    expect(result.ok).toBe(true)
  })

  test("accessibility a11y:announce rejects missing message", () => {
    const ctx = createMockContext()
    accessibility.host(ctx)
    const handler = ctx.handlers.get("a11y:announce")!
    const result = handler({}) as any
    expect(result.ok).toBe(false)
  })

  test("accessibility a11y:announce succeeds and sends to webview", () => {
    const ctx = createMockContext()
    accessibility.host(ctx)
    const handler = ctx.handlers.get("a11y:announce")!
    const result = handler({ message: "Hello screen reader" }) as any
    expect(result.ok).toBe(true)
    expect(ctx.sent.some((s) => s.action === "a11y:announce")).toBe(true)
  })

  test("navigation nav:back returns ok", () => {
    const ctx = createMockContext()
    navigation.host(ctx)
    const handler = ctx.handlers.get("nav:back")!
    const result = handler(null) as any
    expect(result.ok).toBe(true)
  })

  test("dock:setbadge returns ok", () => {
    const ctx = createMockContext()
    dock.host(ctx)
    const handler = ctx.handlers.get("dock:setbadge")!
    const result = handler("3") as any
    expect(result.ok).toBe(true)
  })

  test("findinpage find:start returns ok", () => {
    const ctx = createMockContext()
    findinpage.host(ctx)
    const handler = ctx.handlers.get("find:start")!
    const result = handler({ text: "search term" }) as any
    expect(result.ok).toBe(true)
  })

  test("findinpage find:stop returns ok", () => {
    const ctx = createMockContext()
    findinpage.host(ctx)
    const handler = ctx.handlers.get("find:stop")!
    const result = handler(null) as any
    expect(result.ok).toBe(true)
  })

  test("lifecycle app:getinfo returns platform info", () => {
    const ctx = createMockContext()
    lifecycle.host(ctx)
    const handler = ctx.handlers.get("app:getinfo")!
    const result = handler(null) as any
    expect(result.ok).toBe(true)
    expect(result.platform).toBe(process.platform)
    expect(typeof result.pid).toBe("number")
  })

  test("lifecycle app:activate sends event and returns ok", () => {
    const ctx = createMockContext()
    lifecycle.host(ctx)
    const handler = ctx.handlers.get("app:activate")!
    const result = handler(null) as any
    expect(result.ok).toBe(true)
  })

  test("crashreporter crash:report writes a report", () => {
    const ctx = createMockContext()
    crashreporter.host(ctx)
    const handler = ctx.handlers.get("crash:report")!
    const result = handler({ message: "test crash", stack: "at test:1" }) as any
    expect(result.ok).toBe(true)
  })

  test("crashreporter crash:list returns reports", () => {
    const ctx = createMockContext()
    crashreporter.host(ctx)
    const handler = ctx.handlers.get("crash:list")!
    const result = handler(null) as any
    expect(result.ok).toBe(true)
    expect(Array.isArray(result.reports)).toBe(true)
  })

  test("i18n i18n:t returns key when no translations loaded", () => {
    const ctx = createMockContext()
    i18n.host(ctx)
    const handler = ctx.handlers.get("i18n:t")!
    const result = handler({ key: "hello.world" }) as any
    expect(result.text).toBe("hello.world")
  })

  test("securestorage:set rejects missing params", async () => {
    const ctx = createMockContext()
    securestorage.host(ctx)
    const handler = ctx.handlers.get("securestorage:set")!
    const result = await handler({}) as any
    expect(result.ok).toBe(false)
    expect(result.error).toContain("required")
  })

  test("securestorage:get rejects missing params", async () => {
    const ctx = createMockContext()
    securestorage.host(ctx)
    const handler = ctx.handlers.get("securestorage:get")!
    const result = await handler({}) as any
    expect(result.ok).toBe(false)
  })

  test("securestorage:delete rejects missing params", async () => {
    const ctx = createMockContext()
    securestorage.host(ctx)
    const handler = ctx.handlers.get("securestorage:delete")!
    const result = await handler({}) as any
    expect(result.ok).toBe(false)
  })

  test("downloads download:start rejects missing url", async () => {
    const ctx = createMockContext()
    downloads.host(ctx)
    const handler = ctx.handlers.get("download:start")!
    const result = await handler({}) as any
    expect(result.ok).toBe(false)
    expect(result.error).toContain("url is required")
  })

  test("downloads download:cancel rejects missing id", async () => {
    const ctx = createMockContext()
    downloads.host(ctx)
    const handler = ctx.handlers.get("download:cancel")!
    const result = await handler({}) as any
    expect(result.ok).toBe(false)
  })

  test("fs:read rejects missing path", async () => {
    const ctx = createMockContext()
    fs.host(ctx)
    const handler = ctx.handlers.get("fs:read")!
    const result = await handler({}) as any
    expect(result.ok).toBe(false)
    expect(result.error).toContain("path is required")
  })

  test("fs:write rejects missing path", async () => {
    const ctx = createMockContext()
    fs.host(ctx)
    const handler = ctx.handlers.get("fs:write")!
    const result = await handler({}) as any
    expect(result.ok).toBe(false)
  })

  test("fs:exists rejects missing path", async () => {
    const ctx = createMockContext()
    fs.host(ctx)
    const handler = ctx.handlers.get("fs:exists")!
    const result = await handler({}) as any
    expect(result.ok).toBe(false)
  })
})
