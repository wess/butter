import { test, expect, afterEach, describe } from "bun:test"

const {
  createSharedRegion,
  openSharedRegion,
  signalToShim,
  tryWaitForShimSignal,
  destroySharedRegion,
} = await import("../src/ipc/shmem")

const uniqueName = () => {
  const id = Date.now() % 100000
  return process.platform === "win32" ? `bt${id}` : `/bt${id}`
}

let cleanup: string[] = []

afterEach(() => {
  for (const name of cleanup) {
    try { destroySharedRegion(name) } catch {}
  }
  cleanup = []
})

describe("platform shared memory", () => {
  test("create region with correct size", () => {
    const name = uniqueName()
    cleanup.push(name)
    const region = createSharedRegion(name, 4096)
    expect(region.size).toBe(4096)
    expect(region.buffer.length).toBe(4096)
    expect(region.name).toBe(name)
  })

  test("open existing region sees writes", () => {
    const name = uniqueName()
    cleanup.push(name)
    const creator = createSharedRegion(name, 4096)
    const opener = openSharedRegion(name, 4096)
    creator.buffer[0] = 0xaa
    expect(opener.buffer[0]).toBe(0xaa)
    opener.buffer[1] = 0xbb
    expect(creator.buffer[1]).toBe(0xbb)
  })

  test("event signaling round-trip", () => {
    const name = uniqueName()
    cleanup.push(name)
    const region = createSharedRegion(name, 4096)
    expect(tryWaitForShimSignal(region)).toBe(false)
    signalToShim(region)
    expect(tryWaitForShimSignal(region)).toBe(true)
    expect(tryWaitForShimSignal(region)).toBe(false)
  })
})
