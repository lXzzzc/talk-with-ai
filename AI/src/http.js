import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { isDesktopRuntime } from './runtime.js'
import { shouldUseNativeHttp } from './httpRouting.js'

/**
 * Use Tauri's Rust HTTP client for packaged desktop requests. It is not subject
 * to WebView CORS. Browser/dev relative URLs continue through the normal fetch
 * path so Vite and Nginx can proxy `/api` as before.
 */
export async function httpFetch(input, init = {}) {
  const rawUrl = input instanceof Request ? input.url : String(input)
  if (shouldUseNativeHttp(rawUrl, isDesktopRuntime(), globalThis.location?.origin)) {
    const headers = new Headers(init.headers)
    // WebView2 may attach `http://tauri.localhost` as the Origin even though the
    // request is sent by the native plugin. Spring then rejects it before the
    // controller runs. Native requests have no browser origin boundary, so use
    // the destination origin to match the server's same-origin CORS policy.
    headers.set('Origin', new URL(rawUrl).origin)

    try {
      return await tauriFetch(input, { connectTimeout: 15_000, ...init, headers })
    } catch (error) {
      // The plugin rejects with a regular Error when its native request is
      // cancelled. Normalize it so existing AbortController handling works.
      if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      throw error
    }
  }
  return await globalThis.fetch(input, init)
}
