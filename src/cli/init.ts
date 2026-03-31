import { resolve, join, dirname, basename } from "path"

const REPO_BASE = "https://raw.githubusercontent.com/wess/butter/main/templates"

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.text()
}

const fetchRegistry = async (): Promise<Record<string, string[]>> => {
  const text = await fetchText(`${REPO_BASE}/registry.json`)
  return JSON.parse(text)
}

const replacePlaceholders = (content: string, name: string): string =>
  content.replaceAll("{{name}}", name)

const outputName = (relPath: string): string =>
  relPath.endsWith(".tmpl") ? relPath.slice(0, -5) : relPath

const parseArgs = (args: string[]): { name: string; template: string } => {
  let template = "vanilla"
  let name = ""

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--template" && args[i + 1]) {
      template = args[i + 1]
      i++
    } else if (!args[i].startsWith("--")) {
      name = args[i]
    }
  }

  return { name, template }
}

export const runInit = async (rawArgs: string[]): Promise<void> => {
  const { name, template } = parseArgs(rawArgs)

  if (!name) {
    console.error("Usage: butter init <name> [--template vanilla|react|svelte|vue]")
    process.exit(1)
  }

  console.log("Fetching templates...")
  const registry = await fetchRegistry()

  const files = registry[template]
  if (!files) {
    const available = Object.keys(registry).join(", ")
    console.error(`Unknown template "${template}". Available: ${available}`)
    process.exit(1)
  }

  const target = resolve(process.cwd(), name)
  const projectName = basename(name)

  const exists = await Bun.file(join(target, "butter.yaml")).exists()
  if (exists) {
    console.error(`Directory "${name}" already contains a Butter project.`)
    process.exit(1)
  }

  console.log(`Creating project "${projectName}" using template "${template}"...`)

  const fetches = files.map(async (relPath) => {
    const url = `${REPO_BASE}/${template}/${relPath}`
    const content = await fetchText(url)
    return { relPath, content }
  })

  const results = await Promise.all(fetches)

  for (const { relPath, content } of results) {
    const dest = join(target, outputName(relPath))
    const destDir = dirname(dest)
    const { mkdir } = await import("fs/promises")
    await mkdir(destDir, { recursive: true })
    await Bun.write(dest, replacePlaceholders(content, projectName))
  }

  console.log()
  console.log("Done! Next steps:")
  console.log()
  console.log(`  cd ${name}`)
  console.log("  bun install")
  console.log("  bun run dev")
  console.log()
}
