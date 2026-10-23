/** 浏览器与 Electron 都走同源 fetch；桌面端由主进程把 /api 代理到后端。 */
export async function httpFetch(input, init = {}) {
  return await globalThis.fetch(input, init)
}
