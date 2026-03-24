import type { Menu, MenuItem, MenuSection } from "../types"

export const resolveShortcut = (shortcut: string, platform: string): string =>
  shortcut.replace("CmdOrCtrl", platform === "darwin" ? "Cmd" : "Ctrl")

const resolveItem = (item: MenuItem, platform: string): MenuItem => {
  if ("separator" in item) return item
  return {
    ...item,
    shortcut: item.shortcut ? resolveShortcut(item.shortcut, platform) : undefined,
  }
}

const resolveSection = (section: MenuSection, platform: string): MenuSection => ({
  label: section.label,
  items: section.items.map((item) => resolveItem(item, platform)),
})

export const serializeMenu = (menu: Menu, platform: string): string =>
  JSON.stringify(menu.map((section) => resolveSection(section, platform)))

export const loadMenu = async (projectDir: string): Promise<Menu | null> => {
  const path = `${projectDir}/src/host/menu.ts`
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  try {
    const mod = await import(path)
    if (!mod.default || !Array.isArray(mod.default)) {
      console.warn(`Warning: ${path} must export a default array of menu sections`)
      return null
    }
    return mod.default as Menu
  } catch (err) {
    console.warn(`Warning: Failed to load menu from ${path}:`, err instanceof Error ? err.message : err)
    return null
  }
}
