const ensureReturn = (code: string): string => {
  return /\breturn\b/.test(code) ? code : `return (${code})`
}

const REPLACER_FN = `
  (k, v) => {
    if (v && typeof v === "object" && v.nodeType === 1) {
      return { "[type]": "DOMElement", outerHTML: v.outerHTML }
    }
    if (typeof v === "function") return { "[type]": "function", name: v.name }
    return v
  }
`.trim()

export const wrapEval = (userCode: string, awaitPromise: boolean): string => {
  if (awaitPromise) {
    return `(async () => {
      try {
        const r = await (async function(){ ${ensureReturn(userCode)} })()
        return JSON.stringify({ result: r }, ${REPLACER_FN})
      } catch (e) {
        return JSON.stringify({ error: String(e) })
      }
    })()`
  }
  return `(() => {
    try {
      const r = (function(){ ${ensureReturn(userCode)} })()
      return JSON.stringify({ result: r }, ${REPLACER_FN})
    } catch (e) {
      return JSON.stringify({ error: String(e) })
    }
  })()`
}

export const wrapClick = (selector: string): string => {
  const sel = JSON.stringify(selector)
  return `(() => {
    try {
      const el = document.querySelector(${sel})
      if (!el) throw new Error("No element matched: " + ${sel})
      el.click()
      return JSON.stringify({ ok: true })
    } catch (e) {
      return JSON.stringify({ error: String(e) })
    }
  })()`
}

export const wrapFill = (selector: string, value: string): string => {
  const sel = JSON.stringify(selector)
  const val = JSON.stringify(value)
  return `(() => {
    try {
      const el = document.querySelector(${sel})
      if (!el) throw new Error("No element matched: " + ${sel})
      el.value = ${val}
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      return JSON.stringify({ ok: true })
    } catch (e) {
      return JSON.stringify({ error: String(e) })
    }
  })()`
}
