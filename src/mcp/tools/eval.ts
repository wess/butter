import { wrapEval } from "../wrap"

export type EvalInput = { code: string; await_promise?: boolean }
export type EvalOutput = { result?: unknown; error?: string }

type Control = (action: string, data: unknown) => Promise<unknown>

export const evalTool = {
  name: "eval_javascript",
  description:
    "Execute JavaScript in the running webview and return its JSON-serialized result. " +
    "Result must fit in ~60KB after JSON encoding. Use multiple calls or selectorize " +
    "the value first if larger. ~32ms minimum round-trip latency per call.",
  inputSchema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "JS source. Bare expressions (e.g., 'document.title') are auto-returned; explicit `return` is also supported.",
      },
      await_promise: {
        type: "boolean",
        description: "If true, the snippet is treated as async and its Promise is awaited.",
      },
    },
    required: ["code"],
  },
  handler: async (input: EvalInput, control: Control): Promise<EvalOutput> => {
    const wrapped = wrapEval(input.code, input.await_promise === true)
    const raw = (await control("mcp:eval", { code: wrapped })) as string
    try {
      return JSON.parse(raw) as EvalOutput
    } catch {
      return { error: `Could not parse shim response: ${raw}` }
    }
  },
}
