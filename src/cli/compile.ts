import { join, basename, dirname, relative } from "path"
import { readdir } from "fs/promises"
import { loadConfig } from "../config"
import { compileShim, shimBinaryPath, shimSourcePath, needsRecompile } from "../shim"
import { runDoctor, printDoctorResults } from "./doctor"
import { stripBinary } from "./strip"
import { parseTarget, assertNativePlatform } from "./crosscompile"

const collectFiles = async (dir: string, base: string = dir): Promise<Record<string, string>> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: Record<string, string> = {}

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      Object.assign(files, await collectFiles(fullPath, base))
    } else {
      const relativePath = fullPath.slice(base.length + 1)
      const content = await Bun.file(fullPath).arrayBuffer()
      files[relativePath] = Buffer.from(content).toString("base64")
    }
  }

  return files
}

export const runCompile = async (projectDir: string, args: string[] = []): Promise<void> => {
  const target = parseTarget(args)
  if (target) assertNativePlatform(target)

  const results = await runDoctor()
  const allOk = printDoctorResults(results)
  if (!allOk) {
    console.error("\nFix the issues above before compiling.")
    process.exit(1)
  }

  const config = await loadConfig(projectDir)
  const appName = config.window.title.toLowerCase().replace(/[^a-z0-9]/g, "") || basename(projectDir)

  console.log(`\nCompiling "${config.window.title}"...`)

  // 1. Compile shim
  const source = shimSourcePath()
  const binary = shimBinaryPath(projectDir)
  if (await needsRecompile(binary, source)) {
    console.log("  Compiling native shim...")
    await compileShim(projectDir)
  }

  // 2. Bundle app assets
  const buildDir = join(projectDir, ".butter", "build")
  console.log("  Bundling app assets...")
  await Bun.build({
    entrypoints: [join(projectDir, config.build.entry)],
    outdir: buildDir,
    minify: true,
  })

  // Inline JS/CSS into HTML — external module scripts fail on file:// in WKWebView
  const builtHtml = join(buildDir, "index.html")
  let htmlContent = await Bun.file(builtHtml).text()

  for (const match of htmlContent.matchAll(/<script[^>]*\ssrc="\.\/([^"]+)"[^>]*><\/script>/g)) {
    const [tag, filename] = match
    const jsFile = Bun.file(join(buildDir, filename))
    if (await jsFile.exists()) {
      htmlContent = htmlContent.replace(tag, `<script type="module">\n${await jsFile.text()}\n</script>`)
    }
  }
  for (const match of htmlContent.matchAll(/<link[^>]*\shref="\.\/([^"]+)"[^>]*>/g)) {
    const [tag, filename] = match
    const cssFile = Bun.file(join(buildDir, filename))
    if (await cssFile.exists()) {
      htmlContent = htmlContent.replace(tag, `<style>\n${await cssFile.text()}\n</style>`)
    }
  }
  await Bun.write(builtHtml, htmlContent)

  // 3. Read shim binary + semhelper as base64
  const shimB64 = Buffer.from(await Bun.file(binary).arrayBuffer()).toString("base64")

  const semhelperPath = join(dirname(import.meta.dir), "ipc", "native", "semhelper.dylib")
  const semhelperB64 = Buffer.from(await Bun.file(semhelperPath).arrayBuffer()).toString("base64")

  // 4. Collect all built assets as base64
  const assets = await collectFiles(buildDir)

  // 5. Generate a host wrapper that re-exports butter's runtime functions
  //    This avoids string-hacking the user's source code.
  const butterDir = join(projectDir, ".butter")
  const runtimePath = join(dirname(import.meta.dir), "runtime", "index.ts")
  const hostPath = join(projectDir, config.build.host)

  // Write a shim module that the host code can import as "butter"
  // bun build --compile resolves imports at compile time
  const butterShimPath = join(butterDir, "buttermodule.ts")
  await Bun.write(butterShimPath, `export { on, send, getWindow, setWindow, createRuntime } from "${runtimePath}";\n`)

  // 6. Generate bootstrap
  const bootstrapPath = join(butterDir, "bootstrap.ts")
  console.log("  Generating bootstrap...")

  // The bootstrap imports host code properly via a generated wrapper
  // that sets up the runtime before importing the user's host module
  const hostWrapperPath = join(butterDir, "hostwrapper.ts")
  await Bun.write(hostWrapperPath, `
import { createRuntime } from "${runtimePath}";
import type { WindowOptions } from "${join(dirname(import.meta.dir), "types", "index.ts")}";

const config: { window: WindowOptions } = ${JSON.stringify({ window: config.window })};

const runtime = createRuntime(config.window);
globalThis.__butterRuntime = runtime;

// Now import the user's host code — it will call on(), send(), etc. from "butter"
// which resolve via the runtime's global instance
await import("${hostPath}");

export { runtime };
`)

  const bootstrap = `
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync, chmodSync, rmSync } from "fs";
import { dlopen, FFIType, toBuffer } from "bun:ffi";

const SHIM_B64 = ${JSON.stringify(shimB64)};
const SEMHELPER_B64 = ${JSON.stringify(semhelperB64)};
const ASSETS: Record<string, string> = ${JSON.stringify(assets)};
const TITLE = ${JSON.stringify(config.window.title)};

// Extract to temp dir
const extractDir = join(tmpdir(), "butter-" + process.pid);
mkdirSync(extractDir, { recursive: true });

const shimPath = join(extractDir, "shim");
writeFileSync(shimPath, Buffer.from(SHIM_B64, "base64"));
chmodSync(shimPath, 0o755);

const semhelperDylibPath = join(extractDir, "semhelper.dylib");
writeFileSync(semhelperDylibPath, Buffer.from(SEMHELPER_B64, "base64"));

for (const [name, b64] of Object.entries(ASSETS)) {
  const filePath = join(extractDir, name);
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, Buffer.from(b64, "base64"));
}

// FFI setup
const O_CREAT = 0x0200, O_RDWR = 0x0002, MODE = 0o600;
const SHM_SIZE = 128 * 1024, HEADER = 64;
const RING = (SHM_SIZE - HEADER) / 2;

const libsys = dlopen("/usr/lib/libSystem.B.dylib", {
  ftruncate: { args: [FFIType.i32, FFIType.i64], returns: FFIType.i32 },
  mmap: { args: [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64], returns: FFIType.ptr },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
  shm_unlink: { args: [FFIType.cstring], returns: FFIType.i32 },
  sem_post: { args: [FFIType.ptr], returns: FFIType.i32 },
  sem_unlink: { args: [FFIType.cstring], returns: FFIType.i32 },
});
const hlp = dlopen(semhelperDylibPath, {
  shm_open_create: { args: [FFIType.cstring, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
  sem_open_create: { args: [FFIType.cstring, FFIType.i32, FFIType.u32, FFIType.u32], returns: FFIType.ptr },
});

const cstr = (s: string) => Buffer.from(s + "\\0");
const shmName = "/butter_" + process.pid;

const fd = hlp.symbols.shm_open_create(cstr(shmName), O_CREAT | O_RDWR, MODE) as number;
if (fd < 0) { console.error("shm_open failed"); process.exit(1); }
libsys.symbols.ftruncate(fd, SHM_SIZE);
const ptr = libsys.symbols.mmap(null, SHM_SIZE, 0x03, 0x01, fd, 0) as number;
libsys.symbols.close(fd);
const buf = new Uint8Array(toBuffer(ptr, 0, SHM_SIZE).buffer, 0, SHM_SIZE);
for (let i = 0; i < HEADER; i++) buf[i] = 0;

const semToBun = hlp.symbols.sem_open_create(cstr(shmName + ".tb"), O_CREAT | O_RDWR, MODE, 0) as number;
const semToShim = hlp.symbols.sem_open_create(cstr(shmName + ".ts"), O_CREAT | O_RDWR, MODE, 0) as number;

// Import host code (sets up handlers via runtime)
const { runtime } = await import("${hostWrapperPath}");

// Spawn shim
const htmlPath = join(extractDir, "index.html");
const proc = Bun.spawn([shimPath, shmName, htmlPath], {
  env: { ...process.env, BUTTER_TITLE: TITLE },
  stderr: "inherit",
});

// IPC
const readU32 = (off: number) => buf[off] | (buf[off+1] << 8) | (buf[off+2] << 16) | (buf[off+3] << 24);
const writeU32 = (off: number, v: number) => { buf[off]=v&0xff; buf[off+1]=(v>>8)&0xff; buf[off+2]=(v>>16)&0xff; buf[off+3]=(v>>24)&0xff; };
const ringAvail = (w: number, r: number) => w >= r ? w - r : RING - r + w;

const readFromShim = () => {
  const msgs: any[] = [];
  let w = readU32(0), r = readU32(4);
  while (ringAvail(w, r) >= 4) {
    const base = HEADER;
    const len = buf[base+r%RING] | (buf[base+(r+1)%RING]<<8) | (buf[base+(r+2)%RING]<<16) | (buf[base+(r+3)%RING]<<24);
    let c = (r+4) % RING;
    if (ringAvail(w, c) < len) break;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) { bytes[i] = buf[base+c%RING]; c = (c+1)%RING; }
    r = c; writeU32(4, r);
    try { msgs.push(JSON.parse(new TextDecoder().decode(bytes))); } catch {}
    w = readU32(0);
  }
  return msgs;
};

const writeToShim = (msg: any) => {
  const json = JSON.stringify(msg);
  const payload = new TextEncoder().encode(json);
  const needed = 4 + payload.length;
  const w = readU32(8), r = readU32(12);
  const free = r > w ? r - w - 1 : RING - (w - r) - 1;
  if (free < needed) return false;
  const base = HEADER + RING;
  let c = w;
  buf[base+c%RING] = payload.length & 0xff; c=(c+1)%RING;
  buf[base+c%RING] = (payload.length>>8) & 0xff; c=(c+1)%RING;
  buf[base+c%RING] = (payload.length>>16) & 0xff; c=(c+1)%RING;
  buf[base+c%RING] = (payload.length>>24) & 0xff; c=(c+1)%RING;
  for (let i = 0; i < payload.length; i++) { buf[base+c%RING] = payload[i]; c=(c+1)%RING; }
  writeU32(8, c);
  return true;
};

const signal = () => libsys.symbols.sem_post(semToShim);
let running = true, msgId = 1;

const poll = () => {
  if (!running) return;
  for (const msg of readFromShim()) {
    if (msg.type === "invoke") {
      const sendResponse = (result: unknown, error?: string) => {
        const resp: any = { id: msg.id, type: "response", action: msg.action, data: result };
        if (error) resp.error = error;
        if (writeToShim(resp)) signal();
      };
      try {
        const result = runtime.dispatch(msg.action, msg.data);
        if (result instanceof Promise) {
          result.then((v: any) => sendResponse(v), (e: any) => sendResponse(undefined, String(e)));
        } else {
          sendResponse(result);
        }
      } catch (err: any) {
        sendResponse(undefined, err?.message ?? String(err));
      }
    } else if (msg.type === "event") {
      runtime.dispatch(msg.action, msg.data);
    } else if (msg.type === "control" && msg.action === "quit") {
      running = false; return;
    }
  }
  const out = runtime.drainOutgoing();
  let wrote = false;
  for (const m of out) { if (writeToShim(m)) wrote = true; }
  if (wrote) signal();
  setTimeout(poll, 16);
};
poll();

const cleanup = () => {
  libsys.symbols.shm_unlink(cstr(shmName));
  libsys.symbols.sem_unlink(cstr(shmName + ".tb"));
  libsys.symbols.sem_unlink(cstr(shmName + ".ts"));
  try { rmSync(extractDir, { recursive: true, force: true }); } catch {}
};

proc.exited.then(() => { cleanup(); process.exit(0); });
process.on("SIGINT", () => {
  writeToShim({ id: "0", type: "control", action: "quit" });
  signal();
  setTimeout(() => { cleanup(); process.exit(0); }, 1000);
});
`;

  await Bun.write(bootstrapPath, bootstrap)

  // 7. Compile with bun build --compile
  const outputDir = join(projectDir, "dist")
  const outputPath = join(outputDir, appName)
  console.log("  Compiling binary...")
  await Bun.$`mkdir -p ${outputDir}`
  await Bun.$`bun build --compile ${bootstrapPath} --outfile ${outputPath}`

  // 8. Strip debug symbols
  console.log("  Stripping debug symbols...")
  await stripBinary(outputPath)

  const size = Bun.file(outputPath).size
  console.log()
  console.log(`  Binary: ${outputPath}`)
  console.log(`  Size:   ${(size / 1024 / 1024).toFixed(1)} MB`)
}
