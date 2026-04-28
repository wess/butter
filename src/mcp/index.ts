import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import {
  createConsoleBuffer,
  type ConsoleBuffer,
  type ConsoleMessage,
  type ConsoleReadResult,
} from "./console"
import { evalTool } from "./tools/eval"
import { consoleTool } from "./tools/console"
import { screenshotTool } from "./tools/screenshot"
import { clickTool } from "./tools/click"
import { fillTool } from "./tools/fill"

type Control = (action: string, data: unknown) => Promise<unknown>

export type CreateMcpServerOptions = {
  port: number
  consoleBuffer: number
  control: Control
}

export type McpServer = {
  start: () => Promise<void>
  stop: () => Promise<void>
  recordConsole: (msg: { level: ConsoleMessage["level"]; text: string }) => void
  readConsole: (since?: number) => ConsoleReadResult
  listTools: () => { name: string; description: string; inputSchema: unknown }[]
}

const TOOLS = [evalTool, consoleTool, screenshotTool, clickTool, fillTool]

const toolDefs = (): { name: string; description: string; inputSchema: unknown }[] =>
  TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))

const dispatchTool = async (
  name: string,
  args: unknown,
  control: Control,
  buf: ConsoleBuffer,
): Promise<unknown> => {
  switch (name) {
    case "eval_javascript":
      return await evalTool.handler(args as Parameters<typeof evalTool.handler>[0], control)
    case "list_console_messages":
      return await consoleTool.handler(args as Parameters<typeof consoleTool.handler>[0], buf)
    case "take_screenshot":
      return await screenshotTool.handler({} as Parameters<typeof screenshotTool.handler>[0], control)
    case "click":
      return await clickTool.handler(args as Parameters<typeof clickTool.handler>[0], control)
    case "fill":
      return await fillTool.handler(args as Parameters<typeof fillTool.handler>[0], control)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

export const createMcpServer = (opts: CreateMcpServerOptions): McpServer => {
  const buf = createConsoleBuffer(opts.consoleBuffer)
  const server = new Server(
    { name: "butter-dev", version: "1.0.0" },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefs() }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await dispatchTool(
      req.params.name,
      req.params.arguments ?? {},
      opts.control,
      buf,
    )
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] }
  })

  let bunServer: ReturnType<typeof Bun.serve> | null = null
  let transport: WebStandardStreamableHTTPServerTransport | null = null

  return {
    start: async () => {
      transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })
      await server.connect(transport)
      bunServer = Bun.serve({
        hostname: "127.0.0.1",
        port: opts.port,
        async fetch(req: Request) {
          if (new URL(req.url).pathname.startsWith("/mcp")) {
            return await transport!.handleRequest(req)
          }
          return new Response("Not found", { status: 404 })
        },
      })
    },
    stop: async () => {
      bunServer?.stop()
      await server.close().catch(() => {})
      bunServer = null
      transport = null
    },
    recordConsole: (msg) => buf.push(msg),
    readConsole: (since) => buf.read(since),
    listTools: () => toolDefs(),
  }
}
