// Shared shape across all platform shmem backends. semToBun/semToShim are
// POSIX semaphore pointers on darwin/linux (number) and Win32 event HANDLEs
// on win32 (bigint, since handles can have the high bit set), so the field is
// a union — the platform module that produced the region is the only thing
// that consumes it, but the unified type lets dev.ts hold any backend's region.
export type SharedRegion = {
  name: string;
  buffer: Uint8Array;
  pointer: number;
  size: number;
  semToBun: number | bigint;
  semToShim: number | bigint;
};
