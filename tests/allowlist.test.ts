import { test, expect, describe } from "bun:test"

/**
 * Tests for the security allowlist matching logic from src/cli/dev.ts.
 *
 * The isAllowed function is inlined in dev.ts's runDev closure. We replicate
 * the exact logic here to test it in isolation.
 */

const createIsAllowed = (allowlist: string[] | null) => {
  return (action: string): boolean => {
    if (!allowlist) return true
    return allowlist.some((pattern) => {
      if (pattern === "*") return true
      if (pattern.endsWith(":*")) {
        return action.startsWith(pattern.slice(0, -1))
      }
      return pattern === action
    })
  }
}

describe("allowlist: null (no restriction)", () => {
  const isAllowed = createIsAllowed(null)

  test("allows any action", () => {
    expect(isAllowed("greet")).toBe(true)
    expect(isAllowed("dialog:open")).toBe(true)
    expect(isAllowed("some:random:action")).toBe(true)
    expect(isAllowed("")).toBe(true)
  })
})

describe("allowlist: global wildcard '*'", () => {
  const isAllowed = createIsAllowed(["*"])

  test("matches any action", () => {
    expect(isAllowed("greet")).toBe(true)
    expect(isAllowed("dialog:open")).toBe(true)
    expect(isAllowed("shell:exec")).toBe(true)
    expect(isAllowed("")).toBe(true)
  })
})

describe("allowlist: exact match", () => {
  const isAllowed = createIsAllowed(["greet", "math:add"])

  test("matches exact action name", () => {
    expect(isAllowed("greet")).toBe(true)
  })

  test("matches exact namespaced action", () => {
    expect(isAllowed("math:add")).toBe(true)
  })

  test("does not match substring", () => {
    expect(isAllowed("greet2")).toBe(false)
  })

  test("does not match prefix", () => {
    expect(isAllowed("gree")).toBe(false)
  })

  test("does not match unrelated action", () => {
    expect(isAllowed("dialog:open")).toBe(false)
  })

  test("does not match action in same namespace but different name", () => {
    expect(isAllowed("math:subtract")).toBe(false)
  })
})

describe("allowlist: namespace wildcard 'namespace:*'", () => {
  const isAllowed = createIsAllowed(["dialog:*"])

  test("matches action in namespace", () => {
    expect(isAllowed("dialog:open")).toBe(true)
    expect(isAllowed("dialog:save")).toBe(true)
    expect(isAllowed("dialog:folder")).toBe(true)
    expect(isAllowed("dialog:message")).toBe(true)
  })

  test("does not match different namespace", () => {
    expect(isAllowed("shell:open")).toBe(false)
    expect(isAllowed("fs:read")).toBe(false)
  })

  test("does not match bare action with same prefix", () => {
    expect(isAllowed("dialog")).toBe(false)
  })

  test("matches deeply nested actions in namespace", () => {
    // pattern "dialog:*" with startsWith("dialog:") matches any suffix
    expect(isAllowed("dialog:open:advanced")).toBe(true)
  })
})

describe("allowlist: multiple patterns combined", () => {
  const isAllowed = createIsAllowed(["greet", "dialog:*", "math:add"])

  test("matches exact entry", () => {
    expect(isAllowed("greet")).toBe(true)
    expect(isAllowed("math:add")).toBe(true)
  })

  test("matches namespace wildcard entry", () => {
    expect(isAllowed("dialog:open")).toBe(true)
    expect(isAllowed("dialog:save")).toBe(true)
  })

  test("rejects unlisted action", () => {
    expect(isAllowed("shell:exec")).toBe(false)
    expect(isAllowed("math:subtract")).toBe(false)
    expect(isAllowed("fs:read")).toBe(false)
  })
})

describe("allowlist: empty array (blocks everything)", () => {
  const isAllowed = createIsAllowed([])

  test("blocks all actions", () => {
    expect(isAllowed("greet")).toBe(false)
    expect(isAllowed("dialog:open")).toBe(false)
    expect(isAllowed("*")).toBe(false)
    expect(isAllowed("")).toBe(false)
  })
})

describe("allowlist: edge cases", () => {
  test("colon-only namespace wildcard ':*' matches actions starting with ':'", () => {
    const isAllowed = createIsAllowed([":*"])
    expect(isAllowed(":something")).toBe(true)
    expect(isAllowed("something")).toBe(false)
  })

  test("wildcard pattern '*' in array with other entries", () => {
    const isAllowed = createIsAllowed(["greet", "*"])
    expect(isAllowed("anything")).toBe(true)
    expect(isAllowed("dialog:open")).toBe(true)
  })

  test("duplicate patterns do not cause issues", () => {
    const isAllowed = createIsAllowed(["greet", "greet", "greet"])
    expect(isAllowed("greet")).toBe(true)
    expect(isAllowed("other")).toBe(false)
  })

  test("pattern with trailing colon but no star is exact match", () => {
    const isAllowed = createIsAllowed(["dialog:"])
    expect(isAllowed("dialog:")).toBe(true)
    expect(isAllowed("dialog:open")).toBe(false)
  })

  test("single exact action allowlist", () => {
    const isAllowed = createIsAllowed(["only:this"])
    expect(isAllowed("only:this")).toBe(true)
    expect(isAllowed("only:that")).toBe(false)
    expect(isAllowed("only")).toBe(false)
  })
})
