import type { InvokeMap } from "./index"
import { on } from "../runtime"

// Type-safe handler registration
export const createTypedHandlers = <T extends InvokeMap>() => {
  return {
    on: <K extends keyof T>(
      action: K,
      handler: (data: T[K]["input"]) => T[K]["output"] | Promise<T[K]["output"]>,
    ) => {
      on(action as string, handler as any)
    },
  }
}
