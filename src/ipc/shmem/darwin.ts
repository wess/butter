import { dlopen, FFIType, toBuffer } from "bun:ffi"
import { join, dirname } from "path"

const O_CREAT = 0x0200
const O_RDWR = 0x0002
const PROT_READ = 0x01
const PROT_WRITE = 0x02
const MAP_SHARED = 0x01
const MODE = 0o600

const MAP_FAILED = 0xffffffffffffffff
const SEM_FAILED_THRESHOLD = 18446744073709000000

export type SharedRegion = {
  name: string
  buffer: Uint8Array
  pointer: number
  size: number
  semToBun: number
  semToShim: number
}

const libsys = dlopen("/usr/lib/libSystem.B.dylib", {
  ftruncate: { args: [FFIType.i32, FFIType.i64], returns: FFIType.i32 },
  mmap: {
    args: [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64],
    returns: FFIType.ptr,
  },
  munmap: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
  shm_unlink: { args: [FFIType.cstring], returns: FFIType.i32 },
  sem_post: { args: [FFIType.ptr], returns: FFIType.i32 },
  sem_wait: { args: [FFIType.ptr], returns: FFIType.i32 },
  sem_trywait: { args: [FFIType.ptr], returns: FFIType.i32 },
  sem_close: { args: [FFIType.ptr], returns: FFIType.i32 },
  sem_unlink: { args: [FFIType.cstring], returns: FFIType.i32 },
})

// ARM64 variadic ABI workaround -- shm_open and sem_open are variadic
// and Bun FFI cannot call variadic C functions on Apple Silicon correctly
const nativeDir = join(dirname(import.meta.path), "..", "native")
const helperSrc = join(nativeDir, "semhelper.c")
const helperPath = join(nativeDir, "semhelper.dylib")

const helperFile = Bun.file(helperPath)
const srcFile = Bun.file(helperSrc)
if (!helperFile.size || srcFile.lastModified > helperFile.lastModified) {
  const { $ } = await import("bun")
  await $`clang -shared -o ${helperPath} ${helperSrc} -fPIC`.quiet()
}

const helper = dlopen(helperPath, {
  shm_open_create: {
    args: [FFIType.cstring, FFIType.i32, FFIType.u32],
    returns: FFIType.i32,
  },
  shm_open_existing: {
    args: [FFIType.cstring, FFIType.i32],
    returns: FFIType.i32,
  },
  sem_open_create: {
    args: [FFIType.cstring, FFIType.i32, FFIType.u32, FFIType.u32],
    returns: FFIType.ptr,
  },
  sem_open_existing: {
    args: [FFIType.cstring, FFIType.i32],
    returns: FFIType.ptr,
  },
})

const { symbols: sys } = libsys
const { symbols: hlp } = helper

const cstr = (s: string): Buffer => Buffer.from(s + "\0")

const isSemFailed = (p: number): boolean => p >= SEM_FAILED_THRESHOLD || p === 0

const openSem = (name: string, create: boolean): number => {
  const buf = cstr(name)
  const p = create
    ? hlp.sem_open_create(buf, O_CREAT | O_RDWR, MODE, 0)
    : hlp.sem_open_existing(buf, 0)

  if (isSemFailed(p as number)) {
    throw new Error(`sem_open failed for ${name}`)
  }
  return p as number
}

const mapShm = (name: string, size: number, create: boolean): { pointer: number; buffer: Uint8Array } => {
  const nameBuf = cstr(name)
  const fd = create
    ? hlp.shm_open_create(nameBuf, O_CREAT | O_RDWR, MODE) as number
    : hlp.shm_open_existing(nameBuf, O_RDWR) as number

  if (fd < 0) {
    throw new Error(`shm_open failed for ${name}`)
  }

  if (create) {
    const r = sys.ftruncate(fd, size) as number
    if (r !== 0) {
      sys.close(fd)
      throw new Error(`ftruncate failed for ${name}`)
    }
  }

  const pointer = sys.mmap(null, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0) as number
  sys.close(fd)

  if (pointer >= MAP_FAILED) {
    throw new Error(`mmap failed for ${name}`)
  }

  const buffer = toBuffer(pointer, 0, size)
  return { pointer, buffer: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length) }
}

export const createSharedRegion = (name: string, size: number): SharedRegion => {
  const { pointer, buffer } = mapShm(name, size, true)
  const semToBun = openSem(`${name}.tb`, true)
  const semToShim = openSem(`${name}.ts`, true)

  return { name, buffer, pointer, size, semToBun, semToShim }
}

export const openSharedRegion = (name: string, size: number): SharedRegion => {
  const { pointer, buffer } = mapShm(name, size, false)
  const semToBun = openSem(`${name}.tb`, false)
  const semToShim = openSem(`${name}.ts`, false)

  return { name, buffer, pointer, size, semToBun, semToShim }
}

export const signalToBun = (region: SharedRegion): void => {
  const r = sys.sem_post(region.semToBun) as number
  if (r !== 0) throw new Error("sem_post failed on semToBun")
}

export const signalToShim = (region: SharedRegion): void => {
  const r = sys.sem_post(region.semToShim) as number
  if (r !== 0) throw new Error("sem_post failed on semToShim")
}

export const waitForBunSignal = (region: SharedRegion): void => {
  const r = sys.sem_wait(region.semToBun) as number
  if (r !== 0) throw new Error("sem_wait failed on semToBun")
}

export const tryWaitForShimSignal = (region: SharedRegion): boolean => {
  const r = sys.sem_trywait(region.semToShim) as number
  return r === 0
}

export const destroySharedRegion = (name: string): void => {
  sys.shm_unlink(cstr(name))
  sys.sem_unlink(cstr(`${name}.tb`))
  sys.sem_unlink(cstr(`${name}.ts`))
}
