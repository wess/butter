import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  type ConsoleBuffer,
  type ConsoleMessage,
  type ConsoleReadResult,
  createConsoleBuffer,
} from "./console";
import { clickTool } from "./tools/click";
import { consoleTool } from "./tools/console";
import { evalTool } from "./tools/eval";
import { fillTool } from "./tools/fill";
import { screenshotTool } from "./tools/screenshot";

type Control = (action: string, data: unknown) => Promise<unknown>;

export type CreateMcpServerOptions = {
  port: number;
  consoleBuffer: number;
  control: Control;
};

export type McpServer = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  recordConsole: (msg: { level: ConsoleMessage["level"]; text: string }) => void;
  readConsole: (since?: number) => ConsoleReadResult;
  listTools: () => { name: string; description: string; inputSchema: unknown }[];
};

const TOOLS = [evalTool, consoleTool, screenshotTool, clickTool, fillTool];

const toolDefs = (): { name: string; description: string; inputSchema: unknown }[] =>
  TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));

const dispatchTool = async (
  name: string,
  args: unknown,
  control: Control,
  buf: ConsoleBuffer,
): Promise<unknown> => {
  switch (name) {
    case "eval_javascript":
      return await evalTool.handler(args as Parameters<typeof evalTool.handler>[0], control);
    case "list_console_messages":
      return await consoleTool.handler(args as Parameters<typeof consoleTool.handler>[0], buf);
    case "take_screenshot":
      return await screenshotTool.handler(
        {} as Parameters<typeof screenshotTool.handler>[0],
        control,
      );
    case "click":
      return await clickTool.handler(args as Parameters<typeof clickTool.handler>[0], control);
    case "fill":
      return await fillTool.handler(args as Parameters<typeof fillTool.handler>[0], control);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

// The MCP SDK's WebStandardStreamableHTTPServerTransport throws
// "Stateless transport cannot be reused" if a transport handles more than
// one request. In stateless mode (no sessionIdGenerator) the SDK requires
// a fresh transport — and a fresh Server bound to it — per request, so
// that's what we do here.
const buildServer = (control: Control, buf: ConsoleBuffer): Server => {
  const server = new Server(
    { name: "butter-dev", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefs() }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await dispatchTool(req.params.name, req.params.arguments ?? {}, control, buf);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
  return server;
};

export const createMcpServer = (opts: CreateMcpServerOptions): McpServer => {
  const buf = createConsoleBuffer(opts.consoleBuffer);
  let bunServer: ReturnType<typeof Bun.serve> | null = null;

  return {
    start: async () => {
      bunServer = Bun.serve({
        hostname: "127.0.0.1",
        port: opts.port,
        async fetch(req: Request) {
          if (!new URL(req.url).pathname.startsWith("/mcp")) {
            return new Response("Not found", { status: 404 });
          }
          // Fresh server + transport per request: required by the SDK in
          // stateless mode; also avoids cross-request message-id collisions.
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            // Buffer the result into a single JSON response. Without this the
            // transport streams over SSE, and the per-request `server.close()`
            // below tears the stream down before the body is written — clients
            // then read an empty body. JSON mode returns the full payload from
            // handleRequest, so closing afterwards is safe.
            enableJsonResponse: true,
          });
          const server = buildServer(opts.control, buf);
          await server.connect(transport);
          try {
            return await transport.handleRequest(req);
          } finally {
            // Best-effort teardown; transport is single-use and the Server
            // owns no persistent state we need to keep across requests.
            server.close().catch(() => {});
          }
        },
      });
    },
    stop: async () => {
      bunServer?.stop();
      bunServer = null;
    },
    recordConsole: (msg) => buf.push(msg),
    readConsole: (since) => buf.read(since),
    listTools: () => toolDefs(),
  };
};
