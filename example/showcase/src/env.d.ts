declare global {
  const butter: {
    invoke: (action: string, data?: unknown) => Promise<unknown>
    on: (action: string, handler: (data: unknown) => void) => void
    off: (action: string, handler: (data: unknown) => void) => void
    stream: (action: string, data: unknown, onChunk: (chunk: unknown) => void) => Promise<void>
    contextMenu: (items: Array<{ label: string; action: string } | { separator: true }>) => void
    tray: {
      set: (opts: { title?: string; tooltip?: string; items?: Array<{ label: string; action: string } | { separator: true }> }) => Promise<unknown>
      remove: () => Promise<unknown>
    }
    notify: {
      send: (opts: { title: string; body: string; subtitle?: string }) => Promise<unknown>
    }
    clipboard: {
      read: () => Promise<{ ok: boolean; text: string }>
      write: (text: string) => Promise<{ ok: boolean }>
    }
    theme: {
      get: () => Promise<{ ok: boolean; theme: "dark" | "light" }>
      onChange: (handler: (data: { theme: "dark" | "light" }) => void) => void
    }
    fs: {
      read: (path: string) => Promise<{ ok: boolean; content: string }>
      write: (path: string, content: string) => Promise<{ ok: boolean }>
      exists: (path: string) => Promise<{ ok: boolean; exists: boolean }>
      readdir: (path: string) => Promise<{ ok: boolean; entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }> }>
      stat: (path: string) => Promise<{ ok: boolean; stat: { size: number; modified: number; created: number; isDirectory: boolean; isFile: boolean } }>
      mkdir: (path: string) => Promise<{ ok: boolean }>
      remove: (path: string) => Promise<{ ok: boolean }>
    }
  }
}

export {}
