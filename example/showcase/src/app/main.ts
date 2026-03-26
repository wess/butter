// -- Helpers --

const $ = (id: string) => document.getElementById(id)!
const log = (el: HTMLElement, msg: string, cls = "") => {
  const line = document.createElement("div")
  line.className = `line ${cls}`
  line.textContent = msg
  el.appendChild(line)
  el.scrollTop = el.scrollHeight
}
const clearEl = (el: HTMLElement) => { el.innerHTML = "" }

// -- Navigation --

const navButtons = document.querySelectorAll<HTMLButtonElement>("#nav button")
const sections = document.querySelectorAll<HTMLElement>(".section")

const showSection = (name: string) => {
  sections.forEach((s) => s.classList.toggle("visible", s.id === `sec-${name}`))
  navButtons.forEach((b) => b.classList.toggle("active", b.dataset.section === name))
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => showSection(btn.dataset.section!))
})

// ============================================================
// INVOKE / IPC
// ============================================================

$("greetbtn").addEventListener("click", async () => {
  const name = ($("greetinput") as HTMLInputElement).value || "World"
  const out = $("greetoutput")
  clearEl(out)
  log(out, `Invoking "greet" with name: ${name}`, "info")

  try {
    const result = await butter.invoke("greet", { name }) as { message: string }
    log(out, `Response: ${result.message}`, "ok")
  } catch (err) {
    log(out, `Error: ${err}`, "err")
  }
})

$("envbtn").addEventListener("click", async () => {
  const out = $("envoutput")
  clearEl(out)
  log(out, "Fetching environment...", "info")

  try {
    const env = await butter.invoke("env:get") as Record<string, string>
    for (const [key, val] of Object.entries(env)) {
      log(out, `${key}: ${val}`, "accent")
    }
  } catch (err) {
    log(out, `Error: ${err}`, "err")
  }
})

// ============================================================
// SYSTEM INFO
// ============================================================

const loadSystemInfo = async () => {
  const grid = $("sysinfogrid")
  grid.innerHTML = ""

  try {
    const info = await butter.invoke("system:info") as Record<string, unknown>
    const fields = [
      ["Platform", info.platform],
      ["Architecture", info.arch],
      ["Hostname", info.hostname],
      ["Home Dir", info.homedir],
      ["CPU", info.cpuModel],
      ["CPU Cores", info.cpuCores],
      ["Total RAM", `${info.totalMemory} MB`],
      ["Free RAM", `${info.freeMemory} MB`],
      ["Bun Version", info.bunVersion],
      ["Node Compat", info.nodeVersion],
      ["Host PID", info.pid],
      ["Uptime", `${info.uptime}s`],
    ]

    for (const [label, value] of fields) {
      const item = document.createElement("div")
      item.className = "infoitem"
      item.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`
      grid.appendChild(item)
    }
  } catch (err) {
    grid.innerHTML = `<div class="infoitem"><div class="label">Error</div><div class="value" style="color: var(--error);">${err}</div></div>`
  }
}

$("sysinfobtn").addEventListener("click", loadSystemInfo)

$("screenbtn").addEventListener("click", async () => {
  const out = $("screenoutput")
  clearEl(out)
  log(out, "Querying screens...", "info")

  try {
    const result = await butter.invoke("screen:list") as { ok: boolean; screens: unknown }
    if (result.ok) {
      log(out, JSON.stringify(result.screens, null, 2), "ok")
    } else {
      log(out, "Screen list not available on this platform", "accent")
    }
  } catch (err) {
    log(out, `Error: ${err}`, "err")
  }
})

// ============================================================
// WINDOW CONTROLS
// ============================================================

const windowLog = (msg: string, cls = "ok") => log($("windowoutput"), msg, cls)

$("winmaximize").addEventListener("click", async () => {
  await butter.invoke("window:maximize")
  windowLog("Window maximized")
})

$("winminimize").addEventListener("click", async () => {
  await butter.invoke("window:minimize")
  windowLog("Window minimized")
})

$("winfullscreen").addEventListener("click", async () => {
  await butter.invoke("window:fullscreen", { enable: true })
  windowLog("Entered fullscreen")
})

$("winexitfullscreen").addEventListener("click", async () => {
  await butter.invoke("window:fullscreen", { enable: false })
  windowLog("Exited fullscreen")
})

$("winalwaysontop").addEventListener("click", async () => {
  await butter.invoke("window:alwaysontop", { enable: true })
  windowLog("Always on top: enabled")
})

$("winalwaysontopoff").addEventListener("click", async () => {
  await butter.invoke("window:alwaysontop", { enable: false })
  windowLog("Always on top: disabled")
})

$("winresize").addEventListener("click", async () => {
  const w = Number(($("winwidth") as HTMLInputElement).value) || 1000
  const h = Number(($("winheight") as HTMLInputElement).value) || 700
  await butter.invoke("window:resize", { width: w, height: h })
  windowLog(`Resized to ${w}x${h}`)
})

$("winsettitle").addEventListener("click", async () => {
  const title = ($("wintitle") as HTMLInputElement).value || "Butter Showcase"
  await butter.invoke("window:settitle", { title })
  windowLog(`Title set to "${title}"`)
})

// ============================================================
// DIALOGS
// ============================================================

const dialogLog = (msg: string, cls = "ok") => log($("dialogoutput"), msg, cls)

$("dlgopen").addEventListener("click", async () => {
  try {
    const result = await butter.invoke("dialog:open", {
      title: "Select a File",
      filters: [
        { name: "All Files", extensions: ["*"] },
        { name: "Text Files", extensions: ["txt", "md", "json"] },
        { name: "Images", extensions: ["png", "jpg", "gif", "svg"] },
      ],
      multiple: true,
    }) as { paths: string[]; cancelled: boolean }

    if (result.cancelled) {
      dialogLog("Open dialog cancelled", "accent")
    } else {
      dialogLog(`Selected files: ${result.paths.join(", ")}`)
    }
  } catch (err) {
    dialogLog(`Error: ${err}`, "err")
  }
})

$("dlgsave").addEventListener("click", async () => {
  try {
    const result = await butter.invoke("dialog:save", {
      title: "Save File",
      defaultName: "document.txt",
      filters: [
        { name: "Text Files", extensions: ["txt"] },
        { name: "JSON", extensions: ["json"] },
      ],
    }) as { path: string; cancelled: boolean }

    if (result.cancelled) {
      dialogLog("Save dialog cancelled", "accent")
    } else {
      dialogLog(`Save path: ${result.path}`)
    }
  } catch (err) {
    dialogLog(`Error: ${err}`, "err")
  }
})

$("dlgfolder").addEventListener("click", async () => {
  try {
    const result = await butter.invoke("dialog:folder", {
      title: "Choose a Folder",
    }) as { paths: string[]; cancelled: boolean }

    if (result.cancelled) {
      dialogLog("Folder dialog cancelled", "accent")
    } else {
      dialogLog(`Selected folder: ${result.paths.join(", ")}`)
    }
  } catch (err) {
    dialogLog(`Error: ${err}`, "err")
  }
})

$("dlgalert").addEventListener("click", async () => {
  try {
    await butter.invoke("dialog:message", {
      title: "Alert",
      message: "This is an alert dialog from the Butter Showcase.",
      type: "info",
      buttons: ["OK"],
    })
    dialogLog("Alert dismissed")
  } catch (err) {
    dialogLog(`Error: ${err}`, "err")
  }
})

$("dlgconfirm").addEventListener("click", async () => {
  try {
    const result = await butter.invoke("dialog:message", {
      title: "Confirm Action",
      message: "Do you want to proceed with this action?",
      type: "info",
      buttons: ["Cancel", "OK"],
    }) as { button: number; cancelled: boolean }

    if (result.button === 1) {
      dialogLog("Confirmed!", "ok")
    } else {
      dialogLog("Cancelled", "accent")
    }
  } catch (err) {
    dialogLog(`Error: ${err}`, "err")
  }
})

$("dlgmsginfo").addEventListener("click", async () => {
  try {
    await butter.invoke("dialog:message", {
      title: "Information",
      message: "Butter is a lightweight desktop framework.",
      detail: "Built with Bun and native webviews.",
      type: "info",
      buttons: ["Got it"],
    })
    dialogLog("Info dialog dismissed")
  } catch (err) {
    dialogLog(`Error: ${err}`, "err")
  }
})

$("dlgmsgwarn").addEventListener("click", async () => {
  try {
    await butter.invoke("dialog:message", {
      title: "Warning",
      message: "This action might cause unexpected behavior.",
      type: "warning",
      buttons: ["Cancel", "Continue"],
    })
    dialogLog("Warning dialog dismissed")
  } catch (err) {
    dialogLog(`Error: ${err}`, "err")
  }
})

$("dlgmsgerr").addEventListener("click", async () => {
  try {
    await butter.invoke("dialog:message", {
      title: "Error",
      message: "Something went wrong!",
      detail: "This is a simulated error dialog for demonstration.",
      type: "error",
      buttons: ["OK"],
    })
    dialogLog("Error dialog dismissed")
  } catch (err) {
    dialogLog(`Error: ${err}`, "err")
  }
})

// ============================================================
// CLIPBOARD
// ============================================================

$("clipwrite").addEventListener("click", async () => {
  const text = ($("clipinput") as HTMLInputElement).value
  const out = $("clipoutput")
  clearEl(out)

  try {
    const result = await butter.clipboard.write(text)
    log(out, `Written to clipboard: "${text}"`, "ok")
  } catch (err) {
    log(out, `Error: ${err}`, "err")
  }
})

$("clipread").addEventListener("click", async () => {
  const out = $("clipoutput")

  try {
    const result = await butter.clipboard.read()
    log(out, `Clipboard content: "${result.text}"`, "ok")
  } catch (err) {
    log(out, `Error: ${err}`, "err")
  }
})

// ============================================================
// THEME
// ============================================================

$("themebtn").addEventListener("click", async () => {
  const out = $("themeoutput")
  clearEl(out)

  try {
    const result = await butter.theme.get()
    log(out, `Current theme: ${result.theme}`, result.theme === "dark" ? "accent" : "info")
  } catch (err) {
    log(out, `Error: ${err}`, "err")
  }
})

// Listen for theme changes automatically
butter.theme.onChange((data) => {
  const out = $("themeoutput")
  log(out, `Theme changed to: ${data.theme}`, "accent")
})

// ============================================================
// TRAY
// ============================================================

$("trayset").addEventListener("click", async () => {
  const out = $("trayoutput")
  clearEl(out)

  try {
    await butter.tray.set({
      title: "Butter",
      tooltip: "Butter Showcase is running",
      items: [
        { label: "Show Window", action: "tray:show" },
        { label: "About", action: "tray:about" },
        { separator: true },
        { label: "Quit", action: "quit" },
      ],
    })
    log(out, "Tray icon set with menu items", "ok")
  } catch (err) {
    log(out, `Error: ${err}`, "err")
  }
})

$("trayremove").addEventListener("click", async () => {
  const out = $("trayoutput")

  try {
    await butter.tray.remove()
    log(out, "Tray icon removed", "ok")
  } catch (err) {
    log(out, `Error: ${err}`, "err")
  }
})

// ============================================================
// NOTIFICATIONS
// ============================================================

$("notifybtn").addEventListener("click", async () => {
  const title = ($("notifytitle") as HTMLInputElement).value || "Notification"
  const body = ($("notifybody") as HTMLInputElement).value || "Test notification"
  const out = $("notifyoutput")

  try {
    await butter.notify.send({ title, body })
    log(out, `Notification sent: "${title}"`, "ok")
  } catch (err) {
    log(out, `Error: ${err}`, "err")
  }
})

// ============================================================
// FILE SYSTEM
// ============================================================

$("fsbrowse").addEventListener("click", async () => {
  const path = ($("fspath") as HTMLInputElement).value || "/"
  const out = $("fsoutput")
  clearEl(out)
  log(out, `Browsing: ${path}`, "info")

  try {
    const result = await butter.fs.readdir(path)
    if (!result.ok) {
      log(out, "Failed to read directory", "err")
      return
    }

    const entries = result.entries
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    for (const entry of entries) {
      const icon = entry.isDirectory ? "[dir]" : "[file]"
      const cls = entry.isDirectory ? "accent" : ""
      log(out, `${icon}  ${entry.name}`, cls)
    }

    log(out, `\n${entries.length} entries`, "info")
  } catch (err) {
    log(out, `Error: ${err}`, "err")
  }
})

$("fsread").addEventListener("click", async () => {
  const path = ($("fsreadpath") as HTMLInputElement).value
  const out = $("fsreadoutput")
  clearEl(out)

  if (!path) {
    log(out, "Enter a file path first", "accent")
    return
  }

  log(out, `Reading: ${path}`, "info")

  try {
    const result = await butter.fs.read(path)
    if (result.ok) {
      // Show first 2000 chars to avoid flooding
      const preview = result.content.length > 2000
        ? `${result.content.slice(0, 2000)}\n...(truncated)`
        : result.content
      log(out, preview, "")
    } else {
      log(out, "Failed to read file", "err")
    }
  } catch (err) {
    log(out, `Error: ${err}`, "err")
  }
})

// ============================================================
// STREAMING
// ============================================================

$("streambtn").addEventListener("click", async () => {
  const max = Number(($("streammax") as HTMLInputElement).value) || 10
  const out = $("streamoutput")
  const fill = $("streamfill")
  clearEl(out)
  fill.style.width = "0%"

  log(out, `Starting count stream to ${max}...`, "info")

  try {
    // Request the stream. The host will send chunks via sendChunk.
    // We use butter.on to listen for chunk events keyed by request ID.
    const result = await butter.invoke("stream:count", { max }) as { started: boolean }

    if (result.started) {
      log(out, "Stream started, receiving chunks...", "accent")
    }
  } catch (err) {
    log(out, `Error: ${err}`, "err")
  }
})

// Listen for stream chunk events
butter.on("chunk", (data: unknown) => {
  const chunk = data as { id: string; type: string; data: { current: number; total: number; done?: boolean } }
  const out = $("streamoutput")
  const fill = $("streamfill")

  if (chunk?.data) {
    const { current, total, done } = chunk.data
    const pct = Math.round((current / total) * 100)
    fill.style.width = `${pct}%`

    if (done) {
      log(out, `Stream complete! Counted to ${total}.`, "ok")
    } else {
      log(out, `Received: ${current}/${total} (${pct}%)`, "")
    }
  }
})

// ============================================================
// EVENTS
// ============================================================

let tickHandler: ((data: unknown) => void) | null = null

const subscribeToTicks = () => {
  if (tickHandler) return

  const out = $("eventoutput")
  clearEl(out)
  log(out, "Subscribed to host:tick events", "ok")

  tickHandler = (data: unknown) => {
    const tick = data as { count: number; timestamp: number; memoryUsage: number }
    const time = new Date(tick.timestamp).toLocaleTimeString()
    log(out, `[${time}] tick #${tick.count} | heap: ${tick.memoryUsage} MB`, "")

    // Also update sidebar status
    const info = $("tickinfo")
    info.textContent = `Tick #${tick.count} | ${tick.memoryUsage} MB heap`
  }

  butter.on("host:tick", tickHandler)
}

$("eventon").addEventListener("click", subscribeToTicks)

$("eventoff").addEventListener("click", () => {
  if (tickHandler) {
    butter.off("host:tick", tickHandler)
    tickHandler = null
    log($("eventoutput"), "Unsubscribed from host:tick", "accent")
  }
})

$("eventclear").addEventListener("click", () => {
  clearEl($("eventoutput"))
})

// Subscribe by default
subscribeToTicks()

// ============================================================
// CONTEXT MENU
// ============================================================

$("contextarea").addEventListener("contextmenu", (e) => {
  e.preventDefault()
  const out = $("contextoutput")

  butter.contextMenu([
    { label: "Copy", action: "ctx:copy" },
    { label: "Paste", action: "ctx:paste" },
    { separator: true },
    { label: "Inspect Element", action: "ctx:inspect" },
    { label: "About Showcase", action: "ctx:about" },
  ])

  log(out, "Context menu shown", "info")
})

// Listen for context menu actions
butter.on("ctx:copy", () => log($("contextoutput"), "Context: Copy clicked", "ok"))
butter.on("ctx:paste", () => log($("contextoutput"), "Context: Paste clicked", "ok"))
butter.on("ctx:inspect", () => log($("contextoutput"), "Context: Inspect clicked", "ok"))
butter.on("ctx:about", () => log($("contextoutput"), "Context: About clicked", "ok"))

// ============================================================
// INIT: load system info on the system section visit
// ============================================================

// Eager-load system info when that section is first shown
const sysBtn = $("sysinfobtn") as HTMLButtonElement
const origSysClick = () => { loadSystemInfo(); sysBtn.removeEventListener("click", origSysClick) }
loadSystemInfo()
