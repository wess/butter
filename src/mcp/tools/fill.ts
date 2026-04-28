import { wrapFill } from "../wrap"

type Control = (action: string, data: unknown) => Promise<unknown>

export type FillInput = { selector: string; value: string }
export type FillOutput = { ok: boolean; error?: string }

export const fillTool = {
  name: "fill",
  description:
    "Set the value of a form input matched by CSS selector and dispatch input/change events. " +
    "Compatible with React/Vue/Svelte controlled inputs because both events fire.",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector. First match is filled." },
      value: { type: "string", description: "Value to set on the matched input." },
    },
    required: ["selector", "value"],
  },
  handler: async (input: FillInput, control: Control): Promise<FillOutput> => {
    const code = wrapFill(input.selector, input.value)
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
