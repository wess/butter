import { test, expect, afterEach, describe } from "bun:test"
import {
  createSharedRegion,
  openSharedRegion,
  signalToBun,
  signalToShim,
  waitForBunSignal,
  tryWaitForShimSignal,
  destroySharedRegion,
} from "../src/ipc/shmem"

// macOS sem names limited to 30 chars (31 including null).
// sem names become: /btXXXXX.tb (11 chars) and /btXXXXX.ts (11 chars)
const uniqueName = () => `/bt${Date.now() % 100000}`

let cleanup: string[] = []

afterEach(() => {
  for (const name of cleanup) {
    try { destroySharedRegion(name) } catch {}
  }
  cleanup = []
})

describe("shared memory", () => {
  test("create a shared region with correct size", () => {
    const name = uniqueName()
    cleanup.push(name)

    const region = createSharedRegion(name, 4096)
    expect(region.size).toBe(4096)
    expect(region.buffer.length).toBe(4096)
    expect(region.name).toBe(name)
    expect(region.pointer).toBeGreaterThan(0)
    expect(region.semToBun).toBeGreaterThan(0)
    expect(region.semToShim).toBeGreaterThan(0)
  })

  test("open existing region sees writes from creator", () => {
    const name = uniqueName()
    cleanup.push(name)

    const creator = createSharedRegion(name, 4096)
    const opener = openSharedRegion(name, 4096)

    // write from creator side
    creator.buffer[0] = 0xaa
    creator.buffer[1] = 0xbb
    creator.buffer[4095] = 0xcc

    // read from opener side
    expect(opener.buffer[0]).toBe(0xaa)
    expect(opener.buffer[1]).toBe(0xbb)
    expect(opener.buffer[4095]).toBe(0xcc)

    // write from opener side
    opener.buffer[2] = 0xdd
    expect(creator.buffer[2]).toBe(0xdd)
  })

  test("semaphore signaling works", () => {
    const name = uniqueName()
    cleanup.push(name)

    const region = createSharedRegion(name, 4096)

    // no signal yet, trywait should return false
    expect(tryWaitForShimSignal(region)).toBe(false)

    // signal to shim, then trywait should succeed
    signalToShim(region)
    expect(tryWaitForShimSignal(region)).toBe(true)

    // consumed, next trywait should fail again
    expect(tryWaitForShimSignal(region)).toBe(false)
  })

  test("signalToBun and waitForBunSignal work", () => {
    const name = uniqueName()
    cleanup.push(name)

    const region = createSharedRegion(name, 4096)

    // post first so wait will not block
    signalToBun(region)
    // this should return immediately
    waitForBunSignal(region)
    // if we get here, it worked
    expect(true).toBe(true)
  })

  test("destroy cleans up and opening nonexistent throws", () => {
    const name = uniqueName()

    createSharedRegion(name, 4096)
    destroySharedRegion(name)

    // opening a destroyed region should throw
    expect(() => openSharedRegion(name, 4096)).toThrow()
  })
})
