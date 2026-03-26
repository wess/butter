;(function () {
  const pending = new Map()
  let nextId = 1
  const listeners = new Map()

  window.__butterReceive = function (json) {
    const msg = JSON.parse(json)
    if (msg.type === "response" && msg.action === "chunk" && msg.data) {
      const entry = pending.get(msg.data.id)
      if (entry && entry.onChunk) entry.onChunk(msg.data.data)
    } else if (msg.type === "response") {
      const entry = pending.get(msg.id)
      if (entry) {
        pending.delete(msg.id)
        if (entry.timer) clearTimeout(entry.timer)
        if (msg.error) entry.reject(new Error(msg.error))
        else entry.resolve(msg.data)
      }
    } else if (msg.type === "event") {
      const handlers = listeners.get(msg.action) || []
      for (const handler of handlers) handler(msg.data)
    }
  }

  const sendToShim = (msg) => {
    window.webkit.messageHandlers.butter.postMessage(JSON.stringify(msg))
  }

  window.butter = {
    invoke: (action, data, opts) => {
      return new Promise((resolve, reject) => {
        const id = String(nextId++)
        const entry = { resolve, reject, timer: null }

        const timeout = opts && opts.timeout
        if (timeout && timeout > 0) {
          entry.timer = setTimeout(() => {
            pending.delete(id)
            reject(new Error(`butter.invoke("${action}") timed out after ${timeout}ms`))
          }, timeout)
        }

        pending.set(id, entry)
        sendToShim({ id, type: "invoke", action, data })
      })
    },
    stream: (action, data, onChunk) => {
      return new Promise((resolve, reject) => {
        const id = String(nextId++)
        const entry = { resolve, reject, timer: null, onChunk }
        pending.set(id, entry)
        sendToShim({ id, type: "invoke", action, data, stream: true })
      })
    },
    on: (action, handler) => {
      if (!listeners.has(action)) listeners.set(action, [])
      listeners.get(action).push(handler)
    },
    off: (action, handler) => {
      const handlers = listeners.get(action)
      if (!handlers) return
      const idx = handlers.indexOf(handler)
      if (idx !== -1) handlers.splice(idx, 1)
    },
    contextMenu: (items) => {
      return butter.invoke("__contextmenu", items)
    },
  }

  // Drag and drop — forward file drops to host
  document.addEventListener("dragover", (e) => e.preventDefault())
  document.addEventListener("drop", (e) => {
    e.preventDefault()
    const files = []
    if (e.dataTransfer && e.dataTransfer.files) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i]
        files.push({ name: f.name, size: f.size, type: f.type, path: f.path || "" })
      }
    }
    if (files.length > 0) {
      sendToShim({ id: String(nextId++), type: "event", action: "drop:files", data: files })
    }
  })
})()
