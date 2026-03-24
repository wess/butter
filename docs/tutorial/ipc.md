# IPC

Butter's IPC connects two worlds: your host code running in Bun, and your UI running in the system webview. Communication happens through a shared memory ring buffer — no sockets, no HTTP, no serialization overhead beyond JSON encoding.

## How It Works

The shared memory region is 128KB, split into two ring buffers: one for messages going from the webview to the host, one for messages going the other way. Each message is length-prefixed JSON. POSIX named semaphores signal when data is available.

From your code, none of this is visible. You call functions.

## The Two APIs

**Host side** — runs in Bun, imported from `"butter"`:

```ts
import { on, send, getWindow, setWindow } from "butter"
```

**Webview side** — runs in the browser context, available as a global:

```ts
butter.invoke("action", data)
butter.on("event", handler)
```

The `butter` global is injected automatically by the native shim. No imports, no setup.

## invoke / on: Request-Response

The most common pattern is the webview calling the host and getting a value back.

Host:

```ts
// src/host/index.ts
import { on } from "butter"

on("greet", (name) => {
  return `Hello, ${name}!`
})
```

Webview:

```ts
// src/app/main.ts
const greeting = await butter.invoke("greet", "World")
console.log(greeting) // "Hello, World!"
```

`butter.invoke` always returns a Promise, even if the host handler is synchronous. Await it.

## Async Handlers

Handlers can be async. The runtime waits for the Promise to resolve before sending the response.

```ts
// src/host/index.ts
import { on } from "butter"

on("read:file", async (path) => {
  const file = Bun.file(path as string)
  return await file.text()
})

on("fetch:json", async (url) => {
  const res = await fetch(url as string)
  return await res.json()
})
```

Webview:

```ts
const contents = await butter.invoke("read:file", "/etc/hostname")
const data = await butter.invoke("fetch:json", "https://api.example.com/data")
```

## Error Handling

If a host handler throws, the error message is sent back to the webview. `butter.invoke` rejects with that message.

Host:

```ts
on("dangerous", (input) => {
  if (!input) throw new Error("input is required")
  return process(input)
})
```

Webview:

```ts
try {
  const result = await butter.invoke("dangerous", null)
} catch (err) {
  console.error(err) // "input is required"
}
```

Errors from async handlers are caught the same way:

```ts
on("fetch:data", async (url) => {
  const res = await fetch(url as string)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json()
})
```

## send / on: Push Events

The host can push events to the webview at any time using `send`. This is one-way — there is no response.

Host:

```ts
import { on, send } from "butter"

on("start:watch", async (path) => {
  const watcher = Bun.watch(path as string)
  for await (const event of watcher) {
    send("file:changed", { path: event.filename, type: event.eventType })
  }
})
```

Webview:

```ts
butter.on("file:changed", (event) => {
  console.log(`${event.path} changed (${event.type})`)
  refreshUI()
})

await butter.invoke("start:watch", "/path/to/dir")
```

`send` is fire-and-forget. If the webview is not listening yet, the message is queued in the ring buffer until the shim delivers it.

## Window Control

The host can read and update window properties:

```ts
import { getWindow, setWindow } from "butter"

// Read current window state
const { title, width, height } = getWindow()

// Update the window title
setWindow({ title: "New Title" })

// Update multiple properties at once
setWindow({ title: "Resized", width: 1200, height: 800 })
```

A common pattern is updating the title to reflect document state:

```ts
on("document:open", (filename) => {
  const doc = openDocument(filename as string)
  setWindow({ title: `${doc.name} — MyApp` })
  return doc
})
```

## Naming Actions

Action names are plain strings. Namespacing with `:` is a convention, not a requirement.

```ts
// Namespaced — recommended for larger apps
on("db:query", handler)
on("file:read", handler)
on("dialog:open", handler)

// Plain — fine for small apps
on("greet", handler)
on("quit", handler)
```

Use the same names on both sides. There is no schema validation — if the action name doesn't match, the call will time out.

## TypeScript Types

The webview `butter` global is typed via `src/env.d.ts`:

```ts
// src/env.d.ts
declare global {
  const butter: {
    invoke: (action: string, data?: unknown) => Promise<unknown>
    on: (action: string, handler: (data: unknown) => void) => void
  }
}

export {}
```

For stronger typing, wrap `butter.invoke` in typed helper functions in your webview code:

```ts
// src/app/api.ts
const greet = (name: string): Promise<string> =>
  butter.invoke("greet", name) as Promise<string>

const readFile = (path: string): Promise<string> =>
  butter.invoke("read:file", path) as Promise<string>

export { greet, readFile }
```

Then import from there instead of calling `butter.invoke` directly:

```ts
// src/app/main.ts
import { greet } from "./api"

const message = await greet("World")
```

## Message Flow Reference

```
Webview                          Host (Bun)
  |                                  |
  | butter.invoke("action", data)    |
  |--------------------------------->|
  |    [ring buffer: invoke msg]     |
  |                                  | on("action", handler)
  |                                  | result = handler(data)
  |    [ring buffer: response msg]   |
  |<---------------------------------|
  | resolve Promise(result)          |
  |                                  |
  |                                  | send("event", data)
  |    [ring buffer: event msg]      |
  |<---------------------------------|
  | butter.on("event", handler)      |
  | handler(data)                    |
```
