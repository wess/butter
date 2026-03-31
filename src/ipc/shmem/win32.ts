import { dlopen, FFIType, toBuffer } from "bun:ffi"

export type SharedRegion = {
  name: string
  buffer: Uint8Array
  pointer: number
  size: number
  semToBun: number
  semToShim: number
}

const kernel32 = dlopen("kernel32.dll", {
  CreateFileMappingA: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.cstring],
    returns: FFIType.ptr,
  },
  OpenFileMappingA: {
    args: [FFIType.u32, FFIType.i32, FFIType.cstring],
    returns: FFIType.ptr,
  },
  MapViewOfFile: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u64],
    returns: FFIType.ptr,
  },
  UnmapViewOfFile: {
    args: [FFIType.ptr],
    returns: FFIType.i32,
  },
  CreateEventA: {
    args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.cstring],
    returns: FFIType.ptr,
  },
  OpenEventA: {
    args: [FFIType.u32, FFIType.i32, FFIType.cstring],
    returns: FFIType.ptr,
  },
  SetEvent: {
    args: [FFIType.ptr],
    returns: FFIType.i32,
  },
  WaitForSingleObject: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.u32,
  },
  CloseHandle: {
    args: [FFIType.ptr],
    returns: FFIType.i32,
  },
})

const { symbols: k32 } = kernel32

// INVALID_HANDLE_VALUE is (HANDLE)-1 = 0xFFFFFFFFFFFFFFFF on 64-bit
// Bun FFI needs this as a pointer via BigInt for correct representation
const INVALID_HANDLE_VALUE = 0xFFFFFFFFFFFFFFFFn
const PAGE_READWRITE = 0x04
const FILE_MAP_ALL_ACCESS = 0x000F001F
const EVENT_MODIFY_STATE = 0x0002
const SYNCHRONIZE = 0x00100000
const WAIT_OBJECT_0 = 0x00000000

const cstr = (s: string): Buffer => Buffer.from(s + "\0")

const createMapping = (name: string, size: number): { pointer: number; handle: number } => {
  const handle = k32.CreateFileMappingA(
    INVALID_HANDLE_VALUE, null, PAGE_READWRITE, 0, size, cstr(name),
  ) as number
  if (!handle) throw new Error(`CreateFileMappingA failed for ${name}`)

  const pointer = k32.MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, size) as number
  if (!pointer) {
    k32.CloseHandle(handle)
    throw new Error(`MapViewOfFile failed for ${name}`)
  }

  return { pointer, handle }
}

const openMapping = (name: string, size: number): { pointer: number; handle: number } => {
  const handle = k32.OpenFileMappingA(FILE_MAP_ALL_ACCESS, 0, cstr(name)) as number
  if (!handle) throw new Error(`OpenFileMappingA failed for ${name}`)

  const pointer = k32.MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, size) as number
  if (!pointer) {
    k32.CloseHandle(handle)
    throw new Error(`MapViewOfFile failed for ${name}`)
  }

  return { pointer, handle }
}

// Track handles and pointer for cleanup (UnmapViewOfFile needs the pointer)
const handles = new Map<string, { map: number; pointer: number; evtTb: number; evtTs: number }>()

export const createSharedRegion = (name: string, size: number): SharedRegion => {
  const { pointer, handle } = createMapping(name, size)
  const buffer = new Uint8Array(toBuffer(pointer, 0, size).buffer, 0, size)

  // Create auto-reset events (bManualReset = FALSE)
  const evtTb = k32.CreateEventA(null, 0, 0, cstr(`${name}_tb`)) as number
  const evtTs = k32.CreateEventA(null, 0, 0, cstr(`${name}_ts`)) as number

  if (!evtTb || !evtTs) throw new Error(`CreateEventA failed for ${name}`)

  handles.set(name, { map: handle, pointer, evtTb, evtTs })

  return { name, buffer, pointer, size, semToBun: evtTb, semToShim: evtTs }
}

export const openSharedRegion = (name: string, size: number): SharedRegion => {
  const { pointer, handle } = openMapping(name, size)
  const buffer = new Uint8Array(toBuffer(pointer, 0, size).buffer, 0, size)

  const evtTb = k32.OpenEventA(EVENT_MODIFY_STATE | SYNCHRONIZE, 0, cstr(`${name}_tb`)) as number
  const evtTs = k32.OpenEventA(EVENT_MODIFY_STATE | SYNCHRONIZE, 0, cstr(`${name}_ts`)) as number

  if (!evtTb || !evtTs) throw new Error(`OpenEventA failed for ${name}`)

  handles.set(name, { map: handle, pointer, evtTb, evtTs })

  return { name, buffer, pointer, size, semToBun: evtTb, semToShim: evtTs }
}

export const signalToBun = (region: SharedRegion): void => {
  k32.SetEvent(region.semToBun)
}

export const signalToShim = (region: SharedRegion): void => {
  k32.SetEvent(region.semToShim)
}

export const waitForBunSignal = (region: SharedRegion): void => {
  k32.WaitForSingleObject(region.semToBun, 0xFFFFFFFF)
}

export const tryWaitForShimSignal = (region: SharedRegion): boolean => {
  const result = k32.WaitForSingleObject(region.semToShim, 0) as number
  return result === WAIT_OBJECT_0
}

export const destroySharedRegion = (name: string): void => {
  const h = handles.get(name)
  if (h) {
    k32.UnmapViewOfFile(h.pointer)
    k32.CloseHandle(h.evtTb)
    k32.CloseHandle(h.evtTs)
    k32.CloseHandle(h.map)
    handles.delete(name)
  }
}
