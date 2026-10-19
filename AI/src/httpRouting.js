/** 本地同源地址必须保留浏览器/Vite 通道；只有桌面跨源请求才交给原生插件。 */
export function shouldUseNativeHttp(url, desktop, pageOrigin) {
  if (!desktop || !/^https?:\/\//i.test(url)) return false
  return new URL(url).origin !== pageOrigin
}

export function withUserId(path, userId, pageOrigin) {
  const absolute = /^https?:\/\//i.test(path)
  const target = new URL(path, pageOrigin)
  target.searchParams.set('userId', userId)
  return absolute ? target.toString() : `${target.pathname}${target.search}${target.hash}`
}
