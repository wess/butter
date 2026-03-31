declare global {
  const butter: {
    invoke: (action: string, data?: unknown, opts?: { timeout?: number }) => Promise<unknown>
    on: (action: string, handler: (data: unknown) => void) => void
    off: (action: string, handler: (data: unknown) => void) => void
  }
}

export {}
