import { resolve, join, dirname, basename } from "path"

const TEMPLATES_DIR = join(dirname(import.meta.path), "..", "templates")

const templateFiles: Record<string, string[]> = {
  vanilla: [
    "butter.yaml",
    "package.json.tmpl",
    "src/app/index.html",
    "src/app/main.ts",
    "src/app/styles.css",
    "src/host/index.ts",
    "src/host/menu.ts",
    "src/env.d.ts",
  ],
  react: [
    "butter.yaml",
    "package.json.tmpl",
    "src/app/index.html",
    "src/app/main.tsx",
    "src/app/styles.css",
    "src/host/index.ts",
    "src/host/menu.ts",
    "src/env.d.ts",
  ],
  svelte: [
    "butter.yaml",
    "package.json.tmpl",
    "src/app/index.html",
    "src/app/main.ts",
    "src/app/app.svelte",
    "src/app/styles.css",
    "src/host/index.ts",
    "src/host/menu.ts",
    "src/env.d.ts",
  ],
  vue: [
    "butter.yaml",
    "package.json.tmpl",
    "src/app/index.html",
    "src/app/main.ts",
    "src/app/app.vue",
    "src/app/styles.css",
    "src/host/index.ts",
    "src/host/menu.ts",
    "src/env.d.ts",
  ],
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

  const files = templateFiles[template]
  if (!files) {
    const available = Object.keys(templateFiles).join(", ")
    console.error(`Unknown template "${template}". Available: ${available}`)
    process.exit(1)
  }

  const templateDir = join(TEMPLATES_DIR, template)
  const templateDirExists = await Bun.file(join(templateDir, "butter.yaml")).exists()
  if (!templateDirExists) {
    console.error(`Template directory not found: ${templateDir}`)
    process.exit(1)
  }

  const target = resolve(process.cwd(), name)
  const projectName = basename(name)

  const exists = await Bun.file(join(target, "butter.yaml")).exists()
  if (exists) {
    console.error(`Directory "${name}" already contains a Butter project.`)
    process.exit(1)
  }

  console.log(`Creating project "${projectName}" using template "${template}" in ${target}`)

  for (const relPath of files) {
    const src = join(templateDir, relPath)
    const dest = join(target, outputName(relPath))
    const destDir = dirname(dest)

    await Bun.$`mkdir -p ${destDir}`

    const content = await Bun.file(src).text()
    const replaced = replacePlaceholders(content, projectName)
    await Bun.write(dest, replaced)
  }

  console.log()
  console.log("Done! Next steps:")
  console.log()
  console.log(`  cd ${name}`)
  console.log("  bun install")
  console.log("  bun run dev")
  console.log()
}
