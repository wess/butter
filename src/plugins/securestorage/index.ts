import type { Plugin, HostContext } from "../../types"

type SetParams = { service: string; key: string; value: string }
type GetParams = { service: string; key: string }
type DeleteParams = { service: string; key: string }

const storeSecret = async (service: string, key: string, value: string): Promise<void> => {
  const platform = process.platform
  if (platform === "darwin") {
    // Delete existing entry first to avoid duplicates, ignore errors
    try {
      await Bun.$`security delete-generic-password -s ${service} -a ${key}`.quiet()
    } catch {
      // entry may not exist
    }
    await Bun.$`security add-generic-password -s ${service} -a ${key} -w ${value}`.quiet()
  } else if (platform === "linux") {
    await Bun.$`secret-tool store --label=${key} service ${service} key ${key}`.write(value)
  } else if (platform === "win32") {
    const script = `
      $secure = ConvertTo-SecureString '${value}' -AsPlainText -Force;
      $cred = New-Object System.Management.Automation.PSCredential('${key}', $secure);
      cmdkey /generic:${service}/${key} /user:${key} /pass:${value}
    `
    await Bun.$`powershell -Command ${script}`.quiet()
  }
}

const retrieveSecret = async (service: string, key: string): Promise<string> => {
  const platform = process.platform
  if (platform === "darwin") {
    const result =
      await Bun.$`security find-generic-password -s ${service} -a ${key} -w`.text()
    return result.trim()
  } else if (platform === "linux") {
    const result = await Bun.$`secret-tool lookup service ${service} key ${key}`.text()
    return result.trim()
  } else if (platform === "win32") {
    const script = `
      $cred = cmdkey /list:${service}/${key};
      $cred
    `
    const result = await Bun.$`powershell -Command ${script}`.text()
    return result.trim()
  }
  return ""
}

const removeSecret = async (service: string, key: string): Promise<void> => {
  const platform = process.platform
  if (platform === "darwin") {
    await Bun.$`security delete-generic-password -s ${service} -a ${key}`.quiet()
  } else if (platform === "linux") {
    await Bun.$`secret-tool clear service ${service} key ${key}`.quiet()
  } else if (platform === "win32") {
    await Bun.$`cmdkey /delete:${service}/${key}`.quiet()
  }
}

const host = (ctx: HostContext): void => {
  ctx.on("securestorage:set", async (data: unknown) => {
    const { service, key, value } = data as SetParams
    if (!service || !key || !value) {
      return { ok: false, error: "service, key, and value are required" }
    }
    try {
      await storeSecret(service, key, value)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("securestorage:get", async (data: unknown) => {
    const { service, key } = data as GetParams
    if (!service || !key) {
      return { ok: false, error: "service and key are required" }
    }
    try {
      const value = await retrieveSecret(service, key)
      return { ok: true, value }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ctx.on("securestorage:delete", async (data: unknown) => {
    const { service, key } = data as DeleteParams
    if (!service || !key) {
      return { ok: false, error: "service and key are required" }
    }
    try {
      await removeSecret(service, key)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}

const webview = (): string => `
(function () {
  if (!window.butter) window.butter = {};
  window.butter.secureStorage = {
    set: function (service, key, value) {
      return window.butter.invoke("securestorage:set", { service: service, key: key, value: value });
    },
    get: function (service, key) {
      return window.butter.invoke("securestorage:get", { service: service, key: key });
    },
    delete: function (service, key) {
      return window.butter.invoke("securestorage:delete", { service: service, key: key });
    }
  };
})();
`

const securestorage: Plugin = {
  name: "securestorage",
  host,
  webview,
}

export default securestorage
