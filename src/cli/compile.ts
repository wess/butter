import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { loadConfig } from "../config";
import { compileShim, needsRecompile, shimBinaryPath, shimSourcePath } from "../shim";
import { assertNativePlatform, parseTarget } from "./crosscompile";
import { printDoctorResults, runDoctor } from "./doctor";
import { writeWebviewBundle } from "./plugins";
import { stripBinary } from "./strip";

const collectFiles = async (dir: string, base: string = dir): Promise<Record<string, string>> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Record<string, string> = {};

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await collectFiles(fullPath, base));
    } else {
      const relativePath = fullPath.slice(base.length + 1);
      const content = await Bun.file(fullPath).arrayBuffer();
      files[relativePath] = Buffer.from(content).toString("base64");
    }
  }

  return files;
};

export const runCompile = async (projectDir: string, args: string[] = []): Promise<void> => {
  const target = parseTarget(args);
  if (target) {
    assertNativePlatform(target);
  }

  const results = await runDoctor();
  const allOk = printDoctorResults(results);
  if (!allOk) {
    console.error("\nFix the issues above before compiling.");
    process.exit(1);
  }

  const config = await loadConfig(projectDir);
  const appName =
    config.window.title.toLowerCase().replace(/[^a-z0-9]/g, "") || basename(projectDir);

  console.log(`\nCompiling "${config.window.title}"...`);

  // 1. Compile shim
  const source = shimSourcePath();
  const binary = shimBinaryPath(projectDir);
  if (await needsRecompile(binary, source)) {
    console.log("  Compiling native shim...");
    await compileShim(projectDir);
  }

  // 2. Bundle app assets
  const buildDir = join(projectDir, ".butter", "build");
  const { rm, mkdir: mkdirp } = await import("node:fs/promises");
  await rm(buildDir, { recursive: true, force: true });
  console.log("  Bundling app assets...");
  await Bun.build({
    entrypoints: [join(projectDir, config.build.entry)],
    outdir: buildDir,
    minify: true,
    splitting: false,
  });

  // Inject plugin webview bundle into index.html — must run BEFORE
  // collectFiles() reads the build dir into base64 assets.
  await writeWebviewBundle(buildDir, config.plugins);

  // Assets are served via butter:// custom scheme handler, no inlining needed

  // 3. Read shim binary (+ semhelper on POSIX) as base64
  const shimB64 = Buffer.from(await Bun.file(binary).arrayBuffer()).toString("base64");
  const isWindows = process.platform === "win32";

  let semhelperB64 = "";
  if (!isWindows) {
    const semExt = process.platform === "darwin" ? "dylib" : "so";
    const semhelperPath = join(dirname(import.meta.dir), "ipc", "native", `semhelper.${semExt}`);
    semhelperB64 = Buffer.from(await Bun.file(semhelperPath).arrayBuffer()).toString("base64");
  }

  // 4. Collect all built assets as base64
  const assets = await collectFiles(buildDir);

  // 5. Generate a host wrapper that re-exports butter's runtime functions
  //    This avoids string-hacking the user's source code.
  const butterDir = join(projectDir, ".butter");
  const runtimePath = join(dirname(import.meta.dir), "runtime", "index.ts");
  const hostPath = join(projectDir, config.build.host);

  // Write a shim module that the host code can import as "butter"
  // bun build --compile resolves imports at compile time
  const butterShimPath = join(butterDir, "buttermodule.ts");
  await Bun.write(
    butterShimPath,
    `export { on, send, getWindow, setWindow, createRuntime } from "${runtimePath}";\n`,
  );

  // 6. Generate bootstrap
  const bootstrapPath = join(butterDir, "bootstrap.ts");
  console.log("  Generating bootstrap...");

  // The bootstrap imports host code properly via a generated wrapper
  // that sets up the runtime before importing the user's host module
  const hostWrapperPath = join(butterDir, "hostwrapper.ts");
  const pluginLoaderPath = join(dirname(import.meta.dir), "cli", "plugins.ts");
  const pluginNames = config.plugins ?? [];
  await Bun.write(
    hostWrapperPath,
    `
import { createRuntime } from "${runtimePath}";
import { loadHostPlugins } from "${pluginLoaderPath}";
import type { WindowOptions } from "${join(dirname(import.meta.dir), "types", "index.ts")}";

const config: { window: WindowOptions; plugins: string[] } = ${JSON.stringify({ window: config.window, plugins: pluginNames })};

const runtime = createRuntime(config.window);
globalThis.__butterRuntime = runtime;

// Register plugin host handlers BEFORE the user's host code loads, so any
// invocations from the webview (or from user host code) hit the plugin
// handlers without races.
loadHostPlugins(config.plugins, runtime);

// Now import the user's host code — it will call on(), send(), etc. from "butter"
// which resolve via the runtime's global instance
await import("${hostPath}");

export { runtime };
`,
  );

  // Frame format MUST match dev.ts and the native shim: [len:u32 LE][flags:u32
  // LE][payload]. A logical message may span multiple frames; only the final
  // one sets FLAG_LAST, and the reader reassembles. The previous version here
  // used a stale length-only header (no flags), so every frame from the shim
  // was misread, JSON.parse threw, and the message was silently dropped —
  // compiled apps' webview->host invokes never resolved.
  const ipcPreamble = `
const SHM_SIZE = 128 * 1024, HEADER = 64;
const RING = (SHM_SIZE - HEADER) / 2;
const TO_BUN = HEADER, TO_SHIM = HEADER + RING;
const FRAME_HEADER = 8, FLAG_LAST = 1, MAX_CHUNK = 16 * 1024;

const readU32 = (off) => (buf[off] | (buf[off+1] << 8) | (buf[off+2] << 16) | (buf[off+3] << 24)) >>> 0;
const writeU32 = (off, v) => { buf[off]=v&0xff; buf[off+1]=(v>>8)&0xff; buf[off+2]=(v>>16)&0xff; buf[off+3]=(v>>24)&0xff; };
const ringAvail = (w, r) => (w >= r ? w - r : RING - r + w);
const ringFree = (w, r) => (r > w ? r - w - 1 : RING - (w - r) - 1);

const ringWrite = (base, cursor, src, n) => {
  const tail = RING - cursor;
  if (n <= tail) { buf.set(src.subarray(0, n), base + cursor); }
  else { buf.set(src.subarray(0, tail), base + cursor); buf.set(src.subarray(tail, n), base); }
};
const ringReadBytes = (base, cursor, n) => {
  const tail = RING - cursor;
  if (n <= tail) return buf.slice(base + cursor, base + cursor + n);
  const out = new Uint8Array(n);
  out.set(buf.subarray(base + cursor, base + RING), 0);
  out.set(buf.subarray(base, base + n - tail), tail);
  return out;
};

const buildFrame = (payload, flags) => {
  const frame = new Uint8Array(FRAME_HEADER + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, payload.length, true);
  view.setUint32(4, flags, true);
  frame.set(payload, FRAME_HEADER);
  return frame;
};

const _pending = [];
let _reasm = [], _reasmLen = 0;

const enqueueOutgoing = (msg) => {
  const payload = new TextEncoder().encode(JSON.stringify(msg));
  if (payload.length === 0) { _pending.push({ bytes: buildFrame(payload, FLAG_LAST), offset: 0 }); return; }
  let off = 0;
  while (off < payload.length) {
    const n = Math.min(payload.length - off, MAX_CHUNK);
    const last = off + n >= payload.length;
    _pending.push({ bytes: buildFrame(payload.subarray(off, off + n), last ? FLAG_LAST : 0), offset: 0 });
    off += n;
  }
};

const flushToShim = () => {
  let any = false;
  while (_pending.length > 0) {
    const item = _pending[0];
    const remaining = item.bytes.length - item.offset;
    if (remaining <= 0) { _pending.shift(); continue; }
    const w = readU32(8), r = readU32(12);
    const space = ringFree(w, r);
    if (space === 0) break;
    const toWrite = Math.min(remaining, space);
    ringWrite(TO_SHIM, w, item.bytes.subarray(item.offset), toWrite);
    writeU32(8, (w + toWrite) % RING);
    item.offset += toWrite;
    any = true;
    if (item.offset >= item.bytes.length) _pending.shift();
    else break;
  }
  return any;
};

// Back-compat single-shot writer for the signal-quit paths.
const writeToShim = (msg) => { enqueueOutgoing(msg); return flushToShim(); };

const mergeReasm = () => {
  if (_reasm.length === 1) { const out = _reasm[0]; _reasm = []; _reasmLen = 0; return out; }
  const merged = new Uint8Array(_reasmLen);
  let p = 0; for (const c of _reasm) { merged.set(c, p); p += c.length; }
  _reasm = []; _reasmLen = 0; return merged;
};

const readFromShim = () => {
  const msgs = [];
  while (true) {
    const w = readU32(0), r = readU32(4);
    const used = ringAvail(w, r);
    if (used < FRAME_HEADER) break;
    const hdr = ringReadBytes(TO_BUN, r, FRAME_HEADER);
    const hv = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength);
    const len = hv.getUint32(0, true);
    const flags = hv.getUint32(4, true);
    if (used < FRAME_HEADER + len) break;
    const payloadStart = (r + FRAME_HEADER) % RING;
    const payload = ringReadBytes(TO_BUN, payloadStart, len);
    writeU32(4, (r + FRAME_HEADER + len) % RING);
    if (len > 0) { _reasm.push(payload); _reasmLen += payload.length; }
    if (flags & FLAG_LAST) {
      const merged = mergeReasm();
      try { msgs.push(JSON.parse(new TextDecoder().decode(merged))); } catch {}
    }
  }
  return msgs;
};
`;

  const ipcLoop = `
let running = true;
const poll = () => {
  if (!running) return;
  for (const msg of readFromShim()) {
    if (msg.type === "invoke") {
      const sendResponse = (result, error) => {
        const resp = { id: msg.id, type: "response", action: msg.action, data: result };
        if (error) resp.error = error;
        enqueueOutgoing(resp);
        if (flushToShim()) signal();
      };
      try {
        const result = runtime.dispatch(msg.action, msg.data);
        if (result instanceof Promise) {
          result.then((v) => sendResponse(v), (e) => sendResponse(undefined, String(e)));
        } else {
          sendResponse(result);
        }
      } catch (err) {
        sendResponse(undefined, err?.message ?? String(err));
      }
    } else if (msg.type === "event") {
      runtime.dispatch(msg.action, msg.data);
    } else if (msg.type === "control" && msg.action === "quit") {
      running = false; return;
    }
  }
  for (const m of runtime.drainOutgoing()) enqueueOutgoing(m);
  if (flushToShim()) signal();
  setTimeout(poll, 16);
};
poll();
`;

  let bootstrap: string;

  if (isWindows) {
    bootstrap = `
import { tmpdir } from "os";
import { join, dirname } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { dlopen, FFIType, toBuffer } from "bun:ffi";

const SHIM_B64 = ${JSON.stringify(shimB64)};
const ASSETS = ${JSON.stringify(assets)};
const TITLE = ${JSON.stringify(config.window.title)};

const extractDir = join(tmpdir(), "butter-" + process.pid);
mkdirSync(extractDir, { recursive: true });

const shimPath = join(extractDir, "shim.exe");
writeFileSync(shimPath, Buffer.from(SHIM_B64, "base64"));

for (const [name, b64] of Object.entries(ASSETS)) {
  const filePath = join(extractDir, name);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, Buffer.from(b64, "base64"));
}

// HANDLEs on Win64 use FFIType.u64 (round-trip as BigInt). Buffer
// pointers (MapViewOfFile return / UnmapViewOfFile arg) stay FFIType.ptr.
const k32 = dlopen("kernel32.dll", {
  CreateFileMappingA: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.cstring], returns: FFIType.u64 },
  MapViewOfFile: { args: [FFIType.u64, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u64], returns: FFIType.ptr },
  UnmapViewOfFile: { args: [FFIType.ptr], returns: FFIType.i32 },
  CreateEventA: { args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.cstring], returns: FFIType.u64 },
  SetEvent: { args: [FFIType.u64], returns: FFIType.i32 },
  CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
});

${ipcPreamble}
const cstr = (s) => Buffer.from(s + "\\0");
const shmName = "butter_" + process.pid;

const hmap = k32.symbols.CreateFileMappingA(0xFFFFFFFFFFFFFFFFn, null, 0x04, 0, SHM_SIZE, cstr(shmName));
if (!hmap) { console.error("CreateFileMappingA failed"); process.exit(1); }
const ptr = k32.symbols.MapViewOfFile(hmap, 0x000F001F, 0, 0, SHM_SIZE);
if (!ptr) { console.error("MapViewOfFile failed"); process.exit(1); }
const buf = new Uint8Array(toBuffer(ptr, 0, SHM_SIZE).buffer, 0, SHM_SIZE);
for (let i = 0; i < HEADER; i++) buf[i] = 0;

const evtToBun = k32.symbols.CreateEventA(null, 0, 0, cstr(shmName + "_tb"));
const evtToShim = k32.symbols.CreateEventA(null, 0, 0, cstr(shmName + "_ts"));

const { runtime } = await import("${hostWrapperPath}");

const htmlPath = join(extractDir, "index.html");
const proc = Bun.spawn([shimPath, shmName, htmlPath], {
  env: { ...process.env, BUTTER_TITLE: TITLE },
  stderr: "inherit",
});

const signal = () => k32.symbols.SetEvent(evtToShim);

${ipcLoop}

const cleanup = () => {
  k32.symbols.UnmapViewOfFile(ptr);
  k32.symbols.CloseHandle(evtToBun);
  k32.symbols.CloseHandle(evtToShim);
  k32.symbols.CloseHandle(hmap);
  try { rmSync(extractDir, { recursive: true, force: true }); } catch {}
};

proc.exited.then(() => { cleanup(); process.exit(0); });
process.on("SIGINT", () => {
  writeToShim({ id: "0", type: "control", action: "quit" });
  signal();
  setTimeout(() => { cleanup(); process.exit(0); }, 1000);
});
process.on("exit", () => { cleanup(); });
`;
  } else {
    const semExt = process.platform === "darwin" ? "dylib" : "so";
    const libPath = process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6";
    const oCreat = process.platform === "darwin" ? "0x0200" : "0x0040";

    bootstrap = `
import { tmpdir } from "os";
import { join, dirname } from "path";
import { mkdirSync, writeFileSync, chmodSync, rmSync } from "fs";
import { dlopen, FFIType, toBuffer } from "bun:ffi";

const SHIM_B64 = ${JSON.stringify(shimB64)};
const SEMHELPER_B64 = ${JSON.stringify(semhelperB64)};
const ASSETS = ${JSON.stringify(assets)};
const TITLE = ${JSON.stringify(config.window.title)};

const extractDir = join(tmpdir(), "butter-" + process.pid);
mkdirSync(extractDir, { recursive: true });

const shimPath = join(extractDir, "shim");
writeFileSync(shimPath, Buffer.from(SHIM_B64, "base64"));
chmodSync(shimPath, 0o755);

const semhelperPath = join(extractDir, "semhelper.${semExt}");
writeFileSync(semhelperPath, Buffer.from(SEMHELPER_B64, "base64"));

for (const [name, b64] of Object.entries(ASSETS)) {
  const filePath = join(extractDir, name);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, Buffer.from(b64, "base64"));
}

const O_CREAT = ${oCreat}, O_RDWR = 0x0002, MODE = 0o600;

${ipcPreamble}

const libsys = dlopen("${libPath}", {
  ftruncate: { args: [FFIType.i32, FFIType.i64], returns: FFIType.i32 },
  mmap: { args: [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64], returns: FFIType.ptr },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
  shm_unlink: { args: [FFIType.cstring], returns: FFIType.i32 },
  sem_post: { args: [FFIType.ptr], returns: FFIType.i32 },
  sem_unlink: { args: [FFIType.cstring], returns: FFIType.i32 },
});
const hlp = dlopen(semhelperPath, {
  shm_open_create: { args: [FFIType.cstring, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
  sem_open_create: { args: [FFIType.cstring, FFIType.i32, FFIType.u32, FFIType.u32], returns: FFIType.ptr },
});

const cstr = (s) => Buffer.from(s + "\\0");
const shmName = "/butter_" + process.pid;

const fd = hlp.symbols.shm_open_create(cstr(shmName), O_CREAT | O_RDWR, MODE);
if (fd < 0) { console.error("shm_open failed"); process.exit(1); }
libsys.symbols.ftruncate(fd, SHM_SIZE);
const ptr = libsys.symbols.mmap(null, SHM_SIZE, 0x03, 0x01, fd, 0);
libsys.symbols.close(fd);
const buf = new Uint8Array(toBuffer(ptr, 0, SHM_SIZE).buffer, 0, SHM_SIZE);
for (let i = 0; i < HEADER; i++) buf[i] = 0;

const semToBun = hlp.symbols.sem_open_create(cstr(shmName + ".tb"), O_CREAT | O_RDWR, MODE, 0);
const semToShim = hlp.symbols.sem_open_create(cstr(shmName + ".ts"), O_CREAT | O_RDWR, MODE, 0);

const { runtime } = await import("${hostWrapperPath}");

const htmlPath = join(extractDir, "index.html");
const proc = Bun.spawn([shimPath, shmName, htmlPath], {
  env: { ...process.env, BUTTER_TITLE: TITLE },
  stderr: "inherit",
});

const signal = () => libsys.symbols.sem_post(semToShim);

${ipcLoop}

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
  }

  await Bun.write(bootstrapPath, bootstrap);

  // 7. Compile with bun build --compile
  const outputDir = join(projectDir, "dist");
  const ext = isWindows ? ".exe" : "";
  const outputPath = join(outputDir, `${appName}${ext}`);
  console.log("  Compiling binary...");
  await mkdirp(outputDir, { recursive: true });
  await Bun.$`bun build --compile ${bootstrapPath} --outfile ${outputPath}`;

  // 8. Strip debug symbols
  console.log("  Stripping debug symbols...");
  await stripBinary(outputPath);

  const size = Bun.file(outputPath).size;
  console.log();
  console.log(`  Binary: ${outputPath}`);
  console.log(`  Size:   ${(size / 1024 / 1024).toFixed(1)} MB`);
};
