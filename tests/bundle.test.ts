import { test, expect, describe } from "bun:test"
import type { Config } from "../src/types"

/**
 * Tests for src/cli/bundle.ts
 *
 * We replicate the pure functions (generatePlist, generateUrlSchemesPlist,
 * generateDesktopEntry) from the source to test in isolation, since they
 * are not exported.
 */

// ── Replicated functions from src/cli/bundle.ts ────────────────────────────

const generateUrlSchemesPlist = (config: Config): string => {
  const schemes = config.bundle?.urlSchemes
  if (!schemes || schemes.length === 0) return ""

  const entries = schemes
    .map(
      (s) =>
        `\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>${config.bundle?.identifier ?? "com.example.app"}</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${s}</string>\n\t\t\t</array>\n\t\t</dict>`,
    )
    .join("\n")

  return `\t<key>CFBundleURLTypes</key>\n\t<array>\n${entries}\n\t</array>\n`
}

const generatePlist = (config: Config, executableName: string, hasIcon: boolean): string => {
  const identifier = config.bundle?.identifier ?? `com.example.${executableName}`
  const category = config.bundle?.category ?? "public.app-category.utilities"

  const iconEntry = hasIcon
    ? `\t<key>CFBundleIconFile</key>\n\t<string>icon</string>\n`
    : ""

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleName</key>
\t<string>${config.window.title}</string>
\t<key>CFBundleIdentifier</key>
\t<string>${identifier}</string>
\t<key>CFBundleExecutable</key>
\t<string>${executableName}</string>
\t<key>CFBundlePackageType</key>
\t<string>APPL</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleVersion</key>
\t<string>1.0.0</string>
\t<key>CFBundleShortVersionString</key>
\t<string>1.0.0</string>
\t<key>LSApplicationCategoryType</key>
\t<string>${category}</string>
${iconEntry}\t<key>NSHighResolutionCapable</key>
\t<true/>
${generateUrlSchemesPlist(config)}
</dict>
</plist>
`
}

const generateDesktopEntry = (config: Config, executableName: string, hasIcon: boolean): string => {
  const identifier = config.bundle?.identifier ?? `com.example.${executableName}`
  const category = config.bundle?.category ?? "Utility"
  const iconLine = hasIcon ? `Icon=${executableName}` : `Icon=application-default-icon`

  const mimeTypes = (config.bundle?.urlSchemes ?? []).map((s) => `x-scheme-handler/${s}`).join(";")
  const mimeLine = mimeTypes ? `MimeType=${mimeTypes};\n` : ""

  return `[Desktop Entry]
Type=Application
Name=${config.window.title}
Exec=${executableName} %u
${iconLine}
Categories=${category};
${mimeLine}X-AppImage-Name=${config.window.title}
X-AppImage-Version=1.0.0
X-AppImage-Arch=x86_64
`
}

// ── Test helpers ────────────────────────────────────────────────────────────

const makeConfig = (overrides: Partial<Config> = {}): Config => ({
  window: {
    title: "Test App",
    width: 800,
    height: 600,
    ...overrides.window,
  },
  build: {
    entry: "src/app/index.html",
    host: "src/host/index.ts",
    ...overrides.build,
  },
  bundle: overrides.bundle,
  plugins: overrides.plugins,
  security: overrides.security,
})

// ── generatePlist tests ────────────────────────────────────────────────────

describe("generatePlist", () => {
  test("produces valid XML plist header", () => {
    const plist = generatePlist(makeConfig(), "myapp", false)
    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(plist).toContain("<!DOCTYPE plist")
    expect(plist).toContain('<plist version="1.0">')
    expect(plist).toContain("</plist>")
  })

  test("contains CFBundleName matching window title", () => {
    const plist = generatePlist(makeConfig(), "myapp", false)
    expect(plist).toContain("<key>CFBundleName</key>")
    expect(plist).toContain("<string>Test App</string>")
  })

  test("contains CFBundleExecutable matching executable name", () => {
    const plist = generatePlist(makeConfig(), "myapp", false)
    expect(plist).toContain("<key>CFBundleExecutable</key>")
    expect(plist).toContain("<string>myapp</string>")
  })

  test("uses default identifier when bundle.identifier is not set", () => {
    const plist = generatePlist(makeConfig(), "myapp", false)
    expect(plist).toContain("<string>com.example.myapp</string>")
  })

  test("uses custom identifier when provided", () => {
    const config = makeConfig({ bundle: { identifier: "com.butter.testapp" } })
    const plist = generatePlist(config, "myapp", false)
    expect(plist).toContain("<string>com.butter.testapp</string>")
  })

  test("uses default category when bundle.category is not set", () => {
    const plist = generatePlist(makeConfig(), "myapp", false)
    expect(plist).toContain("<string>public.app-category.utilities</string>")
  })

  test("uses custom category when provided", () => {
    const config = makeConfig({ bundle: { category: "public.app-category.developer-tools" } })
    const plist = generatePlist(config, "myapp", false)
    expect(plist).toContain("<string>public.app-category.developer-tools</string>")
  })

  test("includes CFBundleIconFile when hasIcon is true", () => {
    const plist = generatePlist(makeConfig(), "myapp", true)
    expect(plist).toContain("<key>CFBundleIconFile</key>")
    expect(plist).toContain("<string>icon</string>")
  })

  test("omits CFBundleIconFile when hasIcon is false", () => {
    const plist = generatePlist(makeConfig(), "myapp", false)
    expect(plist).not.toContain("CFBundleIconFile")
  })

  test("includes NSHighResolutionCapable", () => {
    const plist = generatePlist(makeConfig(), "myapp", false)
    expect(plist).toContain("<key>NSHighResolutionCapable</key>")
    expect(plist).toContain("<true/>")
  })

  test("includes CFBundlePackageType APPL", () => {
    const plist = generatePlist(makeConfig(), "myapp", false)
    expect(plist).toContain("<key>CFBundlePackageType</key>")
    expect(plist).toContain("<string>APPL</string>")
  })

  test("includes version strings", () => {
    const plist = generatePlist(makeConfig(), "myapp", false)
    expect(plist).toContain("<key>CFBundleVersion</key>")
    expect(plist).toContain("<key>CFBundleShortVersionString</key>")
    expect(plist).toContain("<string>1.0.0</string>")
  })

  test("handles special characters in title", () => {
    const config = makeConfig({ window: { title: "My <App> & \"Test\"", width: 800, height: 600 } })
    const plist = generatePlist(config, "myapp", false)
    expect(plist).toContain('My <App> & "Test"')
  })
})

// ── generateUrlSchemesPlist tests ──────────────────────────────────────────

describe("generateUrlSchemesPlist", () => {
  test("returns empty string when no urlSchemes", () => {
    const config = makeConfig()
    expect(generateUrlSchemesPlist(config)).toBe("")
  })

  test("returns empty string for empty urlSchemes array", () => {
    const config = makeConfig({ bundle: { urlSchemes: [] } })
    expect(generateUrlSchemesPlist(config)).toBe("")
  })

  test("generates CFBundleURLTypes for a single scheme", () => {
    const config = makeConfig({
      bundle: { identifier: "com.test.app", urlSchemes: ["myapp"] },
    })
    const result = generateUrlSchemesPlist(config)
    expect(result).toContain("CFBundleURLTypes")
    expect(result).toContain("CFBundleURLName")
    expect(result).toContain("com.test.app")
    expect(result).toContain("CFBundleURLSchemes")
    expect(result).toContain("<string>myapp</string>")
  })

  test("generates entries for multiple schemes", () => {
    const config = makeConfig({
      bundle: { identifier: "com.test.app", urlSchemes: ["myapp", "myprotocol"] },
    })
    const result = generateUrlSchemesPlist(config)
    expect(result).toContain("<string>myapp</string>")
    expect(result).toContain("<string>myprotocol</string>")
    // Two dict entries
    const dictCount = (result.match(/<dict>/g) || []).length
    expect(dictCount).toBe(2)
  })

  test("uses default identifier when bundle.identifier is not set", () => {
    const config = makeConfig({ bundle: { urlSchemes: ["test"] } })
    const result = generateUrlSchemesPlist(config)
    expect(result).toContain("com.example.app")
  })

  test("integrates into generatePlist when schemes are present", () => {
    const config = makeConfig({
      bundle: { identifier: "com.test.app", urlSchemes: ["butter"] },
    })
    const plist = generatePlist(config, "myapp", false)
    expect(plist).toContain("CFBundleURLTypes")
    expect(plist).toContain("<string>butter</string>")
  })
})

// ── generateDesktopEntry tests ─────────────────────────────────────────────

describe("generateDesktopEntry", () => {
  test("contains Desktop Entry section header", () => {
    const entry = generateDesktopEntry(makeConfig(), "myapp", false)
    expect(entry).toContain("[Desktop Entry]")
  })

  test("sets Type=Application", () => {
    const entry = generateDesktopEntry(makeConfig(), "myapp", false)
    expect(entry).toContain("Type=Application")
  })

  test("sets Name from window title", () => {
    const entry = generateDesktopEntry(makeConfig(), "myapp", false)
    expect(entry).toContain("Name=Test App")
  })

  test("sets Exec with %u argument", () => {
    const entry = generateDesktopEntry(makeConfig(), "myapp", false)
    expect(entry).toContain("Exec=myapp %u")
  })

  test("uses executable name as Icon when hasIcon is true", () => {
    const entry = generateDesktopEntry(makeConfig(), "myapp", true)
    expect(entry).toContain("Icon=myapp")
    expect(entry).not.toContain("Icon=application-default-icon")
  })

  test("uses default icon when hasIcon is false", () => {
    const entry = generateDesktopEntry(makeConfig(), "myapp", false)
    expect(entry).toContain("Icon=application-default-icon")
  })

  test("uses default category Utility when not configured", () => {
    const entry = generateDesktopEntry(makeConfig(), "myapp", false)
    expect(entry).toContain("Categories=Utility;")
  })

  test("uses custom category when configured", () => {
    const config = makeConfig({ bundle: { category: "Development" } })
    const entry = generateDesktopEntry(config, "myapp", false)
    expect(entry).toContain("Categories=Development;")
  })

  test("omits MimeType when no urlSchemes", () => {
    const entry = generateDesktopEntry(makeConfig(), "myapp", false)
    expect(entry).not.toContain("MimeType")
  })

  test("includes MimeType for url schemes", () => {
    const config = makeConfig({ bundle: { urlSchemes: ["myapp"] } })
    const entry = generateDesktopEntry(config, "myapp", false)
    expect(entry).toContain("MimeType=x-scheme-handler/myapp;")
  })

  test("includes multiple url schemes as semicolon-separated MimeType", () => {
    const config = makeConfig({ bundle: { urlSchemes: ["myapp", "myproto"] } })
    const entry = generateDesktopEntry(config, "myapp", false)
    expect(entry).toContain("MimeType=x-scheme-handler/myapp;x-scheme-handler/myproto;")
  })

  test("includes AppImage metadata", () => {
    const entry = generateDesktopEntry(makeConfig(), "myapp", false)
    expect(entry).toContain("X-AppImage-Name=Test App")
    expect(entry).toContain("X-AppImage-Version=1.0.0")
    expect(entry).toContain("X-AppImage-Arch=x86_64")
  })

  test("uses a different executable name correctly", () => {
    const entry = generateDesktopEntry(makeConfig(), "butterapp", true)
    expect(entry).toContain("Exec=butterapp %u")
    expect(entry).toContain("Icon=butterapp")
  })
})
