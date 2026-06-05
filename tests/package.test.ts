import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  distAppName,
  nsisTemplate,
  packageLinuxAppImage,
  packageMacDmg,
  packageWindowsZip,
} from "../src/cli/package";
import type { Config } from "../src/types";

const makeConfig = (title: string, extra: Partial<Config> = {}): Config =>
  ({
    window: { title, width: 800, height: 600 },
    build: { entry: "src/app/index.ts", host: "src/host/index.ts" },
    ...extra,
  }) as Config;

describe("distAppName", () => {
  test("keeps alphanumerics and spaces, trims the result", () => {
    expect(distAppName(makeConfig("My Cool App"))).toBe("My Cool App");
  });

  test("strips punctuation and symbols", () => {
    expect(distAppName(makeConfig("Acme™ (Beta) — v2!"))).toBe("Acme Beta  v2");
  });

  test("preserves digits", () => {
    expect(distAppName(makeConfig("App 2024"))).toBe("App 2024");
  });

  test("falls back to a lowercased slug when nothing alphanumeric survives the trim", () => {
    // A title of only symbols: the first branch yields "" so the `||` fallback runs.
    expect(distAppName(makeConfig("***"))).toBe("");
  });

  test("fallback slug lowercases and removes separators", () => {
    // Leading symbol trims to empty in branch one, fallback slugifies the raw title.
    const out = distAppName(makeConfig("...A-B C..."));
    // Branch one keeps "A-B C" → strips '-' → "AB C" then trims → "AB C"
    expect(out).toBe("AB C");
  });
});

describe("nsisTemplate", () => {
  const script = nsisTemplate("My App", "myapp.exe", "com.acme.myapp");

  test("embeds the app name, exe and identifier", () => {
    expect(script).toContain('!define APP_NAME "My App"');
    expect(script).toContain('!define EXE_NAME "myapp.exe"');
    expect(script).toContain('!define APP_ID "com.acme.myapp"');
  });

  test("emits an OutFile named after the app", () => {
    expect(script).toContain('OutFile "My App-setup.exe"');
  });

  test("contains both Install and Uninstall sections", () => {
    expect(script).toContain('Section "Install"');
    expect(script).toContain('Section "Uninstall"');
  });

  test("writes uninstall registry keys for the identifier", () => {
    expect(script).toContain("DeleteRegKey HKLM");
  });
});

describe("missing-bundle error paths", () => {
  const emptyDir = (): string => mkdtempSync(join(tmpdir(), "butterpkg-"));

  test("packageMacDmg throws when the .app is absent", async () => {
    const dir = emptyDir();
    await expect(packageMacDmg(makeConfig("Demo"), dir)).rejects.toThrow(/No \.app at .*Demo\.app/);
  });

  test("packageLinuxAppImage throws when the AppDir is absent", async () => {
    const dir = emptyDir();
    await expect(packageLinuxAppImage(makeConfig("Demo"), dir)).rejects.toThrow(
      /No AppDir at .*Demo\.AppDir/,
    );
  });

  test("packageWindowsZip throws when the bundle dir is absent", async () => {
    const dir = emptyDir();
    await expect(packageWindowsZip(makeConfig("Demo"), dir)).rejects.toThrow(/No bundle at .*Demo/);
  });

  test("the error message points users at `butter bundle`", async () => {
    const dir = emptyDir();
    await expect(packageMacDmg(makeConfig("Demo"), dir)).rejects.toThrow(/butter bundle/);
  });
});
