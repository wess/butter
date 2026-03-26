import { join } from "path"
import { readdirSync, existsSync } from "fs"
import type { Plugin, HostContext } from "../../types"

type Translations = Record<string, string>
type LocaleMap = Record<string, Translations>

let locales: LocaleMap = {}
let currentLocale = "en"
let fallbackLocale = "en"

const detectLocale = (): string => {
  const env = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || ""
  const match = env.match(/^([a-z]{2})/)
  return match ? match[1] : "en"
}

const loadLocales = (dir: string): void => {
  if (!existsSync(dir)) return

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"))
  for (const file of files) {
    const locale = file.replace(".json", "")
    try {
      const content = require(join(dir, file))
      locales[locale] = content
    } catch {
      // skip invalid JSON
    }
  }
}

const translate = (key: string, params?: Record<string, string>): string => {
  let text = locales[currentLocale]?.[key]
    ?? locales[fallbackLocale]?.[key]
    ?? key

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{{${k}}}`, v)
    }
  }

  return text
}

const host = (ctx: HostContext): void => {
  ctx.on("i18n:init", (data: unknown) => {
    const opts = data as { dir?: string; locale?: string; fallback?: string }

    if (opts?.dir) loadLocales(opts.dir)
    if (opts?.locale) currentLocale = opts.locale
    if (opts?.fallback) fallbackLocale = opts.fallback

    if (!opts?.locale) {
      currentLocale = detectLocale()
    }

    return {
      ok: true,
      locale: currentLocale,
      available: Object.keys(locales),
    }
  })

  ctx.on("i18n:t", (data: unknown) => {
    const { key, params } = data as { key: string; params?: Record<string, string> }
    return { text: translate(key, params) }
  })

  ctx.on("i18n:locale", (data: unknown) => {
    if (typeof data === "string") {
      currentLocale = data
    } else {
      const opts = data as { locale: string }
      if (opts?.locale) currentLocale = opts.locale
    }
    ctx.send("i18n:changed", { locale: currentLocale })
    return { ok: true, locale: currentLocale }
  })

  ctx.on("i18n:all", () => {
    return {
      translations: locales[currentLocale] ?? {},
      locale: currentLocale,
    }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  var cache = {};
  window.butter.i18n = {
    init: function (opts) {
      return window.butter.invoke("i18n:init", opts).then(function (r) {
        return window.butter.invoke("i18n:all").then(function (all) {
          cache = all.translations || {};
          return r;
        });
      });
    },
    t: function (key, params) {
      var text = cache[key] || key;
      if (params) {
        Object.keys(params).forEach(function (k) {
          text = text.replace(new RegExp("{{" + k + "}}", "g"), params[k]);
        });
      }
      return text;
    },
    setLocale: function (locale) {
      return window.butter.invoke("i18n:locale", { locale: locale }).then(function (r) {
        return window.butter.invoke("i18n:all").then(function (all) {
          cache = all.translations || {};
          return r;
        });
      });
    },
    getLocale: function () {
      return window.butter.invoke("i18n:locale");
    }
  };
  butter.on("i18n:changed", function (data) {
    window.butter.invoke("i18n:all").then(function (all) {
      cache = all.translations || {};
    });
  });
})();
`

const i18n: Plugin = {
  name: "i18n",
  host,
  webview,
}

export default i18n
