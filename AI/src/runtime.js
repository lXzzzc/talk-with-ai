/** 桌面端能力由 Electron preload 注入的 xilianDesktop 桥接提供。 */
export function isDesktopRuntime() {
  return Boolean(globalThis.xilianDesktop)
}
