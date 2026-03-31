export type { SharedRegion } from "./shmem/darwin"

const platform = process.platform

const mod = platform === "win32"
  ? await import("./shmem/win32")
  : platform === "linux"
    ? await import("./shmem/linux")
    : await import("./shmem/darwin")

export const createSharedRegion = mod.createSharedRegion
export const openSharedRegion = mod.openSharedRegion
export const signalToBun = mod.signalToBun
export const signalToShim = mod.signalToShim
export const waitForBunSignal = mod.waitForBunSignal
export const tryWaitForShimSignal = mod.tryWaitForShimSignal
export const destroySharedRegion = mod.destroySharedRegion
