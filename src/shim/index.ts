import { dirname, join } from "node:path";
import { $ } from "bun";
import { loadConfig } from "../config";
import type { Config, UsageDescriptions } from "../types";

export const shimSourcePath = (): string => {
  const platform = process.platform;
  const file = platform === "darwin" ? "darwin.m" : platform === "linux" ? "linux.c" : "windows.c";
  return join(import.meta.dir, file);
};

export const shimBinaryPath = (projectDir: string): string => {
  const ext = process.platform === "win32" ? ".exe" : "";
  return join(projectDir, ".butter", `shim${ext}`);
};

const usageDescriptionKey: Record<keyof UsageDescriptions, string> = {
  microphone: "NSMicrophoneUsageDescription",
  camera: "NSCameraUsageDescription",
  appleEvents: "NSAppleEventsUsageDescription",
  calendar: "NSCalendarsUsageDescription",
  contacts: "NSContactsUsageDescription",
  reminders: "NSRemindersUsageDescription",
  photos: "NSPhotoLibraryUsageDescription",
  location: "NSLocationUsageDescription",
  bluetooth: "NSBluetoothAlwaysUsageDescription",
  screenCapture: "NSScreenCaptureUsageDescription",
};

const escapePlist = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const generateEmbeddedPlist = (config: Config): string => {
  const identifier = config.bundle?.identifier ?? "com.butter.devshim";
  const title = config.window.title;
  const usage = config.bundle?.usageDescriptions ?? {};
  const usageEntries = Object.entries(usage)
    .filter(
      ([k, v]) =>
        (usageDescriptionKey as Record<string, string>)[k] &&
        typeof v === "string" &&
        (v as string).length > 0,
    )
    .map(
      ([k, v]) =>
        `\t<key>${(usageDescriptionKey as Record<string, string>)[k]}</key>\n\t<string>${escapePlist(v as string)}</string>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleName</key>
\t<string>${escapePlist(title)}</string>
\t<key>CFBundleIdentifier</key>
\t<string>${identifier}.dev</string>
\t<key>CFBundlePackageType</key>
\t<string>APPL</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleShortVersionString</key>
\t<string>0.0.0-dev</string>
\t<key>LSUIElement</key>
\t<false/>
${usageEntries}
</dict>
</plist>
`;
};

export const needsRecompile = async (binaryPath: string, sourcePath: string): Promise<boolean> => {
  const binary = Bun.file(binaryPath);
  if (!(await binary.exists())) {
    return true;
  }

  const source = Bun.file(sourcePath);
  if (source.lastModified > binary.lastModified) {
    return true;
  }

  // Also recompile if the Butter package version changed
  try {
    const versionFile = join(`${binaryPath}.version`);
    const vf = Bun.file(versionFile);
    const pkg = await import("../../package.json");
    const currentVersion = pkg.default?.version ?? pkg.version ?? "";
    if (!(await vf.exists())) {
      return true;
    }
    const cachedVersion = await vf.text();
    return cachedVersion.trim() !== currentVersion;
  } catch {
    return true;
  }
};

export const compileShim = async (projectDir: string): Promise<string> => {
  const source = shimSourcePath();
  const output = shimBinaryPath(projectDir);
  const outputDir = dirname(output);

  const { mkdir } = await import("node:fs/promises");
  await mkdir(outputDir, { recursive: true });

  if (process.platform === "darwin") {
    /*
     * Embed an Info.plist into the binary's __TEXT,__info_plist section so
     * loose (non-bundled) binaries can declare privacy usage descriptions.
     * Without this, macOS Sequoia+ silently denies mic/camera/automation
     * requests in dev mode because the binary has no bundle identity.
     */
    const config = await loadConfig(projectDir);
    const plist = generateEmbeddedPlist(config);
    const plistPath = join(outputDir, "shim.Info.plist");
    await Bun.write(plistPath, plist);

    await $`clang -o ${output} ${source} -framework Cocoa -framework WebKit -framework UniformTypeIdentifiers -fobjc-arc -sectcreate __TEXT __info_plist ${plistPath}`;
  } else if (process.platform === "linux") {
    // -lX11 is required: linux.c calls XStringToKeysym, XKeysymToKeycode,
    // XGrabKey, XUngrabKey directly (global shortcuts). Modern ld with
    // --as-needed (Ubuntu 22.04+) won't pull libX11 transitively from gtk.
    const cflags = await $`pkg-config --cflags gtk+-3.0 webkit2gtk-4.1`.text();
    const libs = await $`pkg-config --libs gtk+-3.0 webkit2gtk-4.1`.text();
    await $`cc -o ${output} ${source} ${cflags.trim().split(" ")} ${libs.trim().split(" ")} -lX11`;
  } else if (process.platform === "win32") {
    try {
      await $`cl.exe /Fe:${output} ${source} /link ole32.lib user32.lib gdi32.lib shell32.lib shcore.lib advapi32.lib WebView2Loader.lib`;
    } catch {
      await $`gcc -o ${output} ${source} -lole32 -luser32 -lgdi32 -lshell32 -lshcore -ladvapi32 -lWebView2Loader -mwindows`;
    }
  }

  // Stamp version so we know when to recompile after package updates
  try {
    const pkg = await import("../../package.json");
    const version = pkg.default?.version ?? pkg.version ?? "";
    await Bun.write(`${output}.version`, version);
  } catch {
    /* non-critical */
  }

  return output;
};

export const spawnShim = async (
  binaryPath: string,
  shmName: string,
  htmlPath: string,
  env?: Record<string, string>,
): Promise<ReturnType<typeof Bun.spawn>> => {
  let execPath = binaryPath;

  // macOS uses argv[0] as the app name in the menu bar.
  // Create a symlink named after the app title so the menu shows the right name.
  if (process.platform !== "win32") {
    const appName = env?.BUTTER_TITLE ?? "Butter App";
    const safeName = appName.replace(/[^a-zA-Z0-9 ]/g, "");
    const linkPath = join(dirname(binaryPath), safeName);

    try {
      await $`ln -sf ${binaryPath} ${linkPath}`.quiet();
      execPath = linkPath;
    } catch {
      // Fall back to the raw binary path
    }
  }

  return Bun.spawn([execPath, shmName, htmlPath], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...env },
  });
};
