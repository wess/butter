import type { ConsoleBuffer, ConsoleReadResult } from "../console"

export type ConsoleInput = { since_cursor?: number }

export const consoleTool = {
  name: "list_console_messages",
  description:
    "Return console.log/warn/error/info messages buffered from the running webview. " +
    "Use the next_cursor in your next call to get only new messages.",
  inputSchema: {
    type: "object",
    properties: {
      since_cursor: {
        type: "number",
        description: "Cursor returned by a previous call. Omit to get all buffered messages.",
      },
    },
  },
  handler: async (input: ConsoleInput, buf: ConsoleBuffer): Promise<ConsoleReadResult> => {
    return buf.read(input.since_cursor)
  },
}
