import { dlopen, FFIType, ptr, CString } from "bun:ffi"

const { symbols: objc } = dlopen("/usr/lib/libobjc.A.dylib", {
  objc_getClass: {
    args: [FFIType.cstring],
    returns: FFIType.ptr,
  },
  sel_registerName: {
    args: [FFIType.cstring],
    returns: FFIType.ptr,
  },
  objc_msgSend: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.ptr,
  },
})

const { symbols: appkit } = dlopen("/System/Library/Frameworks/AppKit.framework/AppKit", {
  NSApplicationLoad: {
    args: [],
    returns: FFIType.bool,
  },
})

const enc = (s: string) => Buffer.from(s + "\0")
const cls = (name: string) => objc.objc_getClass(enc(name))
const sel = (name: string) => objc.sel_registerName(enc(name))

const msgSend = (target: any, selName: string, ...args: any[]) => {
  const { symbols } = dlopen("/usr/lib/libobjc.A.dylib", {
    objc_msgSend: {
      args: [FFIType.ptr, FFIType.ptr, ...args.map(() => FFIType.ptr)],
      returns: FFIType.ptr,
    },
  })
  return (symbols.objc_msgSend as any)(target, sel(selName), ...args)
}

export type TrayItem = {
  label: string
  action: string
}

export type TrayOptions = {
  title?: string
  items?: TrayItem[]
  onAction?: (action: string) => void
}

let statusItem: any = null

export const initTray = (opts: TrayOptions) => {
  appkit.NSApplicationLoad()

  const NSStatusBar = cls("NSStatusBar")
  const systemBar = msgSend(NSStatusBar, "systemStatusBar")
  statusItem = msgSend(systemBar, "statusItemWithLength:", ptr(new BigInt64Array([-1n])))

  if (opts.title) {
    const NSString = cls("NSString")
    const titleStr = msgSend(
      NSString,
      "stringWithUTF8String:",
      ptr(Buffer.from(opts.title + "\0"))
    )
    const button = msgSend(statusItem, "button")
    msgSend(button, "setTitle:", titleStr)
  }
}

export const setTrayTitle = (title: string) => {
  if (!statusItem) return
  const NSString = cls("NSString")
  const titleStr = msgSend(
    NSString,
    "stringWithUTF8String:",
    ptr(Buffer.from(title + "\0"))
  )
  const button = msgSend(statusItem, "button")
  msgSend(button, "setTitle:", titleStr)
}
