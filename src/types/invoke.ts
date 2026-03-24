import type { InvokeMap } from "./index"

// Type-safe invoke wrapper
export const createTypedInvoke = <T extends InvokeMap>() => {
  return {
    invoke: <K extends keyof T>(
      action: K,
      data: T[K]["input"],
      opts?: { timeout?: number },
    ): Promise<T[K]["output"]> => {
      return (globalThis as any).butter.invoke(action as string, data, opts)
    },
  }
}
