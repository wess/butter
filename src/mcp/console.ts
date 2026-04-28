export type ConsoleLevel = "log" | "warn" | "error" | "info"

export type ConsoleMessage = {
  level: ConsoleLevel
  text: string
  timestamp: number
}

export type ConsoleReadResult = {
  messages: ConsoleMessage[]
  next_cursor: number
  dropped?: number
}

export type ConsoleBuffer = {
  push: (msg: { level: ConsoleLevel; text: string }) => void
  read: (since_cursor?: number) => ConsoleReadResult
}

export const createConsoleBuffer = (capacity: number): ConsoleBuffer => {
  const messages: ConsoleMessage[] = []
  let head = 0  // cursor of oldest message currently held
  let next = 0  // cursor that will be assigned to the next push

  return {
    push: ({ level, text }) => {
      messages.push({ level, text, timestamp: Date.now() })
      next++
      if (messages.length > capacity) {
        messages.shift()
        head++
      }
    },
    read: (since = 0) => {
      const startIndex = Math.max(0, since - head)
      const slice = messages.slice(startIndex)
      const dropped = since < head ? head - since : 0
      return {
        messages: slice,
        next_cursor: next,
        ...(dropped > 0 ? { dropped } : {}),
      }
    },
  }
}
