import { on, send, setWindow, maximize, minimize, fullscreen, setAlwaysOnTop, listScreens, sendChunk } from "butter"
import { cpus, totalmem, freemem, hostname, homedir, tmpdir } from "node:os"

// -- Basic invoke/response --

on("greet", (data: { name: string }) => {
  return { message: `Hello, ${data.name}! Welcome to Butter.` }
})

// -- System info --

on("system:info", () => {
  const cpu = cpus()
  return {
    platform: process.platform,
    arch: process.arch,
    hostname: hostname(),
    homedir: homedir(),
    tmpdir: tmpdir(),
    cpuModel: cpu.length > 0 ? cpu[0].model : "unknown",
    cpuCores: cpu.length,
    totalMemory: Math.round(totalmem() / 1024 / 1024),
    freeMemory: Math.round(freemem() / 1024 / 1024),
    bunVersion: Bun.version,
    nodeVersion: process.version,
    pid: process.pid,
    uptime: Math.round(process.uptime()),
  }
})

// -- Window management --

on("window:maximize", () => {
  maximize()
  return { ok: true }
})

on("window:minimize", () => {
  minimize()
  return { ok: true }
})

on("window:fullscreen", (data: { enable: boolean }) => {
  fullscreen(data.enable)
  return { ok: true }
})

on("window:alwaysontop", (data: { enable: boolean }) => {
  setAlwaysOnTop(data.enable)
  return { ok: true }
})

on("window:resize", (data: { width: number; height: number }) => {
  setWindow({ width: data.width, height: data.height })
  return { ok: true }
})

on("window:settitle", (data: { title: string }) => {
  setWindow({ title: data.title })
  return { ok: true }
})

// -- Screen info --

on("screen:list", async () => {
  try {
    const screens = await listScreens()
    return { ok: true, screens }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// -- Streaming demo: sends numbers one at a time --

on("stream:count", (data: { requestId: string; max: number }) => {
  const max = data.max || 10
  let i = 0

  const interval = setInterval(() => {
    i++
    sendChunk(data.requestId, { current: i, total: max })
    if (i >= max) {
      clearInterval(interval)
      sendChunk(data.requestId, { done: true, current: max, total: max })
    }
  }, 200)

  return { started: true, total: max }
})

// -- Environment variables (safe subset) --

on("env:get", () => {
  return {
    shell: process.env.SHELL ?? "unknown",
    lang: process.env.LANG ?? "unknown",
    term: process.env.TERM ?? "unknown",
    user: process.env.USER ?? process.env.USERNAME ?? "unknown",
    home: process.env.HOME ?? process.env.USERPROFILE ?? "unknown",
  }
})

// -- Periodic tick event sent to webview --

let tickCount = 0
setInterval(() => {
  tickCount++
  send("host:tick", {
    count: tickCount,
    timestamp: Date.now(),
    memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  })
}, 3000)
