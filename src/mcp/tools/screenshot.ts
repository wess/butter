import { tmpdir } from "os"
import { join } from "path"
import { unlink } from "fs/promises"

type Control = (action: string, data: unknown) => Promise<unknown>

export type ScreenshotOutput = {
  content: { type: "image"; mimeType: "image/png"; data: string }[]
}

export const screenshotTool = {
  name: "take_screenshot",
  description: "Take a PNG screenshot of the current webview state.",
  inputSchema: { type: "object", properties: {} },
  handler: async (
    _input: Record<string, never>,
    control: Control,
  ): Promise<ScreenshotOutput> => {
    const path = join(tmpdir(), `butter-shot-${process.pid}-${Date.now()}.png`)
    await control("window:screenshot", { path })
    const bytes = await Bun.file(path).bytes()
    await unlink(path).catch(() => {})
    return {
      content: [
        { type: "image", mimeType: "image/png", data: Buffer.from(bytes).toString("base64") },
      ],
    }
  },
}
