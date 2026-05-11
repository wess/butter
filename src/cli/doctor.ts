import { $ } from "bun"

export type CheckResult = {
  name: string
  ok: boolean
  detail: string
  fix?: string
  // Optional checks (Rust/Zig) report status but don't fail the doctor when
  // missing — they're only required if the project has .rs/.zig sources.
  optional?: boolean
}

export const checkBun = async (): Promise<CheckResult> => {
  try {
    const version = Bun.version
    return { name: "Bun", ok: true, detail: `v${version}` }
  } catch {
    return { name: "Bun", ok: false, detail: "Not found", fix: "Install Bun: curl -fsSL https://bun.sh/install | bash" }
  }
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), ms),
    ),
  ])

export const checkCompiler = async (): Promise<CheckResult> => {
  const platform = process.platform
  try {
    if (platform === "darwin") {
      const result = await withTimeout($`clang --version`.text(), 5000)
      const match = result.match(/version\s+([\d.]+)/)
      return { name: "Compiler", ok: true, detail: `clang ${match?.[1] ?? "unknown"}` }
    }
    if (platform === "linux") {
      const result = await withTimeout($`cc -v 2>&1`.text(), 5000)
      return { name: "Compiler", ok: true, detail: result.trim() }
    }
    if (platform === "win32") {
      try {
        const result = await withTimeout($`cl 2>&1`.text(), 5000)
        const match = result.match(/Version\s+([\d.]+)/)
        return { name: "Compiler", ok: true, detail: `MSVC ${match?.[1] ?? "unknown"}` }
      } catch {
        const result = await withTimeout($`gcc --version`.text(), 5000)
        const match = result.match(/gcc.*?([\d.]+)/)
        return { name: "Compiler", ok: true, detail: `MinGW-GCC ${match?.[1] ?? "unknown"}` }
      }
    }
    return { name: "Compiler", ok: false, detail: "Unsupported platform" }
  } catch {
    const fix = platform === "darwin"
      ? "Install Xcode Command Line Tools: xcode-select --install"
      : platform === "linux"
        ? "Install a C compiler (gcc, clang, or tcc)"
        : "Install MSVC (Visual Studio Build Tools) or MinGW-GCC"
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
  if (platform === "win32") {
    try {
      const result = await $`reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv`.text()
      const match = result.match(/pv\s+REG_SZ\s+([\d.]+)/)
      if (match) {
        return { name: "Webview", ok: true, detail: `WebView2 ${match[1]}` }
      }
    } catch {}
    try {
      await $`where WebView2Loader.dll`.quiet()
      return { name: "Webview", ok: true, detail: "WebView2 (loader found)" }
    } catch {}
    return {
      name: "Webview",
      ok: false,
      detail: "MISSING",
      fix: "Install WebView2 Runtime: https://developer.microsoft.com/en-us/microsoft-edge/webview2/",
    }
  }
  return { name: "Webview", ok: false, detail: "Platform not yet supported" }
}

export const checkRust = async (): Promise<CheckResult> => {
  try {
    const rustc = (await withTimeout($`rustc --version`.text(), 5000)).trim()
    let cargoNote = ""
    try {
      const cargo = (await withTimeout($`cargo --version`.text(), 5000)).trim()
      cargoNote = `, ${cargo.split(" ").slice(0, 2).join(" ")}`
    } catch {
      cargoNote = ", cargo not found"
    }
    return { name: "Rust", ok: true, detail: `${rustc}${cargoNote}`, optional: true }
  } catch {
    return {
      name: "Rust",
      ok: false,
      detail: "not installed",
      fix: "Install Rust: https://www.rust-lang.org/tools/install (needed only for .rs native modules)",
      optional: true,
    }
  }
}

export const checkZig = async (): Promise<CheckResult> => {
  try {
    const result = (await withTimeout($`zig version`.text(), 5000)).trim()
    return { name: "Zig", ok: true, detail: `zig ${result}`, optional: true }
  } catch {
    return {
      name: "Zig",
      ok: false,
      detail: "not installed",
      fix: "Install Zig: https://ziglang.org/download (needed only for .zig native modules)",
      optional: true,
    }
  }
}

export const runDoctor = async (): Promise<CheckResult[]> =>
  Promise.all([checkBun(), checkCompiler(), checkWebview(), checkRust(), checkZig()])

export const printDoctorResults = (results: CheckResult[]): boolean => {
  let allOk = true
  const issues: CheckResult[] = []

  for (const r of results) {
    const label = r.optional ? `${r.name} (optional)` : r.name
    const status = r.ok ? r.detail : r.optional ? r.detail : "MISSING"
    const dots = ".".repeat(Math.max(1, 30 - label.length))
    console.log(`  ${label} ${dots} ${status}`)
    if (!r.ok && !r.optional) {
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
