import { wrapClick } from "../wrap"

type Control = (action: string, data: unknown) => Promise<unknown>

export type ClickInput = { selector: string }
export type ClickOutput = { ok: boolean; error?: string }

export const clickTool = {
  name: "click",
  description:
    "Click the first element matched by a CSS selector in the running webview. " +
    "Returns ok:true on success or ok:false with error message if no element matched.",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector. First match is clicked." },
    },
    required: ["selector"],
  },
  handler: async (input: ClickInput, control: Control): Promise<ClickOutput> => {
    const code = wrapClick(input.selector)
    const raw = (await control("mcp:eval", { code })) as string
    try {
      const parsed = JSON.parse(raw) as { ok?: boolean; error?: string }
      if (parsed.error) return { ok: false, error: parsed.error }
      return { ok: parsed.ok === true }
    } catch {
      return { ok: false, error: `Could not parse shim response: ${raw}` }
    }
  },
}
