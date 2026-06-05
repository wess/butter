import { existsSync, mkdirSync } from "node:fs";
import { platform } from "node:os";
import { basename, join } from "node:path";
import { loadConfig } from "../config";
import type { Config, MacOsBundleOptions } from "../types";

type SignOptions = {
  identity?: string;
  entitlements?: string;
  notarize?: boolean;
  hardenedRuntime?: boolean;
  appleId?: string;
  teamId?: string;
  password?: string;
  pfx?: string;
  pfxPassword?: string;
};

const parseArgs = (args: string[]): SignOptions => {
  const opts: SignOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--identity" && next) {
      opts.identity = next;
      i++;
    } else if (arg === "--entitlements" && next) {
      opts.entitlements = next;
      i++;
    } else if (arg === "--notarize") {
      opts.notarize = true;
    } else if (arg === "--no-notarize") {
      opts.notarize = false;
    } else if (arg === "--hardened-runtime") {
      opts.hardenedRuntime = true;
    } else if (arg === "--no-hardened-runtime") {
      opts.hardenedRuntime = false;
    } else if (arg === "--apple-id" && next) {
      opts.appleId = next;
      i++;
    } else if (arg === "--team-id" && next) {
      opts.teamId = next;
      i++;
    } else if (arg === "--password" && next) {
      opts.password = next;
      i++;
    } else if (arg === "--pfx" && next) {
      opts.pfx = next;
      i++;
    } else if (arg === "--pfx-password" && next) {
      opts.pfxPassword = next;
      i++;
    }
  }
  return opts;
};

// Merge config-derived defaults with CLI flags. CLI wins so users can override
// any single field for one-off invocations without editing butter.yaml.
export const resolveMacSignOptions = (
  cliOpts: SignOptions,
  configMac: MacOsBundleOptions | undefined,
): Required<Pick<SignOptions, "notarize" | "hardenedRuntime">> & SignOptions => {
  const mac = configMac ?? {};
  const identity = cliOpts.identity ?? mac.signingIdentity;
  const appleId = cliOpts.appleId ?? mac.appleId ?? process.env.APPLE_ID;
  const teamId = cliOpts.teamId ?? mac.teamId ?? process.env.APPLE_TEAM_ID;
  const password = cliOpts.password ?? mac.appleIdPassword ?? process.env.APPLE_APP_PASSWORD;
  // Notarize only when *requested* AND all three creds are available. We do
  // not flip notarize=true silently just because creds happen to be set — the
  // ad-hoc path is a valid choice for unsigned builds.
  const notarizeRequested = cliOpts.notarize ?? mac.notarize ?? false;
  const notarize = notarizeRequested && Boolean(appleId && teamId && password && identity);
  // Hardened runtime is required by Apple for notarization, but breaks Bun's
  // JIT without the allow-jit entitlement. Default off for ad-hoc signing,
  // on whenever we're notarizing — flipped manually if needed.
  const hardenedRuntime = cliOpts.hardenedRuntime ?? mac.hardenedRuntime ?? notarize;
  return {
    ...cliOpts,
    identity,
    appleId,
    teamId,
    password,
    entitlements: cliOpts.entitlements ?? mac.entitlements,
    notarize,
    hardenedRuntime,
  };
};

// JIT-permissive entitlements required when Hardened Runtime is enabled and
// the app uses JavaScriptCore (Bun's runtime does — every compiled binary).
// Without these, the app crashes at launch with EXC_BAD_INSTRUCTION the
// instant JSC tries to mmap an RWX page.
const JIT_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.security.cs.allow-jit</key>
\t<true/>
\t<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
\t<true/>
\t<key>com.apple.security.cs.disable-library-validation</key>
\t<true/>
</dict>
</plist>
`;

const ensureJitEntitlements = async (projectDir: string): Promise<string> => {
  const dir = join(projectDir, ".butter");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const path = join(dir, "entitlements.plist");
  await Bun.write(path, JIT_ENTITLEMENTS);
  return path;
};

const signMacOS = async (
  appPath: string,
  cliOpts: SignOptions,
  config: Config,
  projectDir: string,
): Promise<void> => {
  const opts = resolveMacSignOptions(cliOpts, config.bundle?.macos);
  const identity = opts.identity ?? "-";
  const allowJit = config.bundle?.macos?.allowJit ?? true;

  console.log(`Signing ${appPath} with identity "${identity}"...`);
  if (opts.hardenedRuntime) {
    console.log("  Hardened Runtime: on");
  }
  if (opts.notarize) {
    console.log("  Will notarize after signing.");
  }

  const codesignArgs = ["--force", "--deep", "--sign", identity];

  // Auto-provide JIT entitlements when Hardened Runtime is on and no user
  // entitlements file was supplied — otherwise notarized Bun apps crash on
  // launch the first time JSC compiles a function.
  let entitlements = opts.entitlements;
  if (opts.hardenedRuntime && !entitlements && allowJit) {
    entitlements = await ensureJitEntitlements(projectDir);
    console.log(`  Generated JIT entitlements: ${entitlements}`);
  }
  if (entitlements) {
    codesignArgs.push("--entitlements", entitlements);
  }

  if (opts.hardenedRuntime) {
    codesignArgs.push("--options", "runtime");
  }
  codesignArgs.push("--timestamp");
  codesignArgs.push(appPath);

  const result = await Bun.$`codesign ${codesignArgs}`.quiet();
  if (result.exitCode !== 0) {
    throw new Error(`codesign failed: ${result.stderr.toString()}`);
  }
  console.log("  Signed successfully.");

  const verify = await Bun.$`codesign --verify --deep --strict ${appPath}`.quiet();
  if (verify.exitCode === 0) {
    console.log("  Verification passed.");
  }

  if (!opts.notarize) {
    return;
  }

  console.log("  Submitting for notarization...");
  const zipPath = `${appPath}.zip`;
  await Bun.$`ditto -c -k --keepParent ${appPath} ${zipPath}`.quiet();

  const notarize =
    await Bun.$`xcrun notarytool submit ${zipPath} --apple-id ${opts.appleId!} --team-id ${opts.teamId!} --password ${opts.password!} --wait`.quiet();

  if (notarize.exitCode === 0) {
    console.log("  Notarization succeeded.");
    await Bun.$`xcrun stapler staple ${appPath}`.quiet();
    console.log("  Ticket stapled.");
  } else {
    console.error(`  Notarization failed: ${notarize.stderr.toString()}`);
  }

  await Bun.$`rm -f ${zipPath}`.quiet();
};

const signWindows = async (
  binaryPath: string,
  cliOpts: SignOptions,
  config: Config,
): Promise<void> => {
  console.log(`Signing ${binaryPath}...`);

  const pfx = cliOpts.pfx ?? config.bundle?.windows?.pfx;
  const pfxPassword = cliOpts.pfxPassword ?? config.bundle?.windows?.pfxPassword;

  if (!pfx) {
    console.error(
      "  Windows signing requires --pfx <certificate.pfx> or bundle.windows.pfx in butter.yaml",
    );
    return;
  }

  const args = [
    "sign",
    "/f",
    pfx,
    "/fd",
    "SHA256",
    "/tr",
    "http://timestamp.digicert.com",
    "/td",
    "SHA256",
  ];
  if (pfxPassword) {
    args.push("/p", pfxPassword);
  }
  args.push(binaryPath);

  const result = await Bun.$`signtool ${args}`.quiet();
  if (result.exitCode !== 0) {
    throw new Error(`signtool failed: ${result.stderr.toString()}`);
  }
  console.log("  Signed successfully.");
};

const signLinux = async (binaryPath: string, opts: SignOptions): Promise<void> => {
  console.log(`Signing ${binaryPath} with GPG...`);

  const identity = opts.identity;
  const gpgArgs = identity
    ? ["--detach-sign", "--armor", "-u", identity, binaryPath]
    : ["--detach-sign", "--armor", binaryPath];

  const result = await Bun.$`gpg ${gpgArgs}`.quiet();
  if (result.exitCode !== 0) {
    throw new Error(`gpg sign failed: ${result.stderr.toString()}`);
  }
  console.log(`  Signature: ${binaryPath}.asc`);
};

export const runSign = async (projectDir: string, args: string[]): Promise<void> => {
  const config = await loadConfig(projectDir);
  const opts = parseArgs(args);
  const os = platform();
  const appName = config.window.title.replace(/[^a-zA-Z0-9 ]/g, "").trim();

  if (os === "darwin") {
    const appPath = join(projectDir, "dist", `${appName}.app`);
    const binaryName = appName.toLowerCase().replace(/[^a-z0-9]/g, "") || basename(projectDir);
    const binaryPath = join(projectDir, "dist", binaryName);

    if (existsSync(appPath)) {
      await signMacOS(appPath, opts, config, projectDir);
    } else if (existsSync(binaryPath)) {
      await signMacOS(binaryPath, opts, config, projectDir);
    } else {
      console.error(
        `No app bundle or binary found in dist/. Run "butter compile" and "butter bundle" first.`,
      );
      process.exit(1);
    }
  } else if (os === "win32") {
    const binaryName = `${appName.toLowerCase().replace(/[^a-z0-9]/g, "") || basename(projectDir)}.exe`;
    const binaryPath = join(projectDir, "dist", binaryName);
    if (!existsSync(binaryPath)) {
      console.error(`Binary not found: ${binaryPath}`);
      process.exit(1);
    }
    await signWindows(binaryPath, opts, config);
  } else if (os === "linux") {
    const binaryName = appName.toLowerCase().replace(/[^a-z0-9]/g, "") || basename(projectDir);
    const binaryPath = join(projectDir, "dist", binaryName);
    if (!existsSync(binaryPath)) {
      console.error(`Binary not found: ${binaryPath}`);
      process.exit(1);
    }
    await signLinux(binaryPath, opts);
  } else {
    console.error(`Code signing not supported on ${os}`);
    process.exit(1);
  }
};
