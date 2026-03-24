import { $ } from "bun"

export type CheckResult = {
  name: string
  ok: boolean
  detail: string
  fix?: string
}

export const checkBun = async (): Promise<CheckResult> => {
  try {
    const version = Bun.version
    return { name: "Bun", ok: true, detail: `v${version}` }
  } catch {
    return { name: "Bun", ok: false, detail: "Not found", fix: "Install Bun: curl -fsSL https://bun.sh/install | bash" }
  }
}

export const checkCompiler = async (): Promise<CheckResult> => {
  const platform = process.platform
  try {
    if (platform === "darwin") {
      const result = await $`clang --version`.text()
      const match = result.match(/version\s+([\d.]+)/)
      return { name: "Compiler", ok: true, detail: `clang ${match?.[1] ?? "unknown"}` }
    }
    if (platform === "linux") {
      const result = await $`tcc -v 2>&1`.text()
      return { name: "Compiler", ok: true, detail: result.trim() }
    }
    return { name: "Compiler", ok: false, detail: "Unsupported platform" }
  } catch {
    const fix = platform === "darwin"
      ? "Install Xcode Command Line Tools: xcode-select --install"
      : platform === "linux"
        ? "Install TinyCC: sudo apt install tcc"
        : "Install MinGW-GCC"
    return { name: "Compiler", ok: false, detail: "Not found", fix }
  }
}

export const checkWebview = async (): Promise<CheckResult> => {
  const platform = process.platform
  if (platform === "darwin") {
    return { name: "Webview", ok: true, detail: "WKWebView (macOS)" }
  }
  if (platform === "linux") {
    try {
      await $`pkg-config --exists webkit2gtk-4.1`
      const version = (await $`pkg-config --modversion webkit2gtk-4.1`.text()).trim()
      return { name: "Webview", ok: true, detail: `WebKitGTK ${version}` }
    } catch {
      return {
        name: "Webview",
        ok: false,
        detail: "MISSING",
        fix: "sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev",
      }
    }
  }
  return { name: "Webview", ok: false, detail: "Platform not yet supported" }
}

export const runDoctor = async (): Promise<CheckResult[]> =>
  Promise.all([checkBun(), checkCompiler(), checkWebview()])

export const printDoctorResults = (results: CheckResult[]): boolean => {
  let allOk = true
  const issues: CheckResult[] = []

  for (const r of results) {
    const status = r.ok ? r.detail : "MISSING"
    const dots = ".".repeat(Math.max(1, 20 - r.name.length))
    console.log(`  ${r.name} ${dots} ${status}`)
    if (!r.ok) {
      allOk = false
      issues.push(r)
    }
  }

  console.log()
  if (allOk) {
    console.log("  All checks passed.")
  } else {
    console.log("  Issues found:")
    for (const issue of issues) {
      if (issue.fix) console.log(`    ${issue.name}: ${issue.fix}`)
    }
  }

  return allOk
}
