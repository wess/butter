// macOS file dialog helpers via osascript
// These are intentionally thin wrappers so the host plugin stays clean.

export type OpenDialogOptions = {
  multiple?: boolean
  fileTypes?: string[]
  prompt?: string
}

export type SaveDialogOptions = {
  defaultName?: string
  prompt?: string
}

export const openDialog = async (opts: OpenDialogOptions = {}): Promise<string[]> => {
  const typeClause =
    opts.fileTypes && opts.fileTypes.length > 0
      ? ` of type {${opts.fileTypes.map((t) => `"${t}"`).join(", ")}}`
      : ""

  const multipleClause = opts.multiple ? " with multiple selections allowed" : ""
  const promptClause = opts.prompt ? ` with prompt "${opts.prompt}"` : ""

  const script = `POSIX path of (choose file${typeClause}${multipleClause}${promptClause})`

  try {
    const result = await Bun.$`osascript -e ${script}`.text()
    const paths = result
      .trim()
      .split(", ")
      .map((p) => p.trim())
      .filter(Boolean)
    return paths
  } catch {
    return []
  }
}

export const saveDialog = async (opts: SaveDialogOptions = {}): Promise<string | null> => {
  const nameClause = opts.defaultName ? ` default name "${opts.defaultName}"` : ""
  const promptClause = opts.prompt ? ` with prompt "${opts.prompt}"` : ""

  const script = `POSIX path of (choose file name${nameClause}${promptClause})`

  try {
    const result = await Bun.$`osascript -e ${script}`.text()
    return result.trim() || null
  } catch {
    return null
  }
}
