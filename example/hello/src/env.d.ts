declare global {
  const butter: {
    invoke: (action: string, data?: unknown) => Promise<unknown>
    on: (action: string, handler: (data: unknown) => void) => void
  }
}

export {}
