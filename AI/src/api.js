import { isDesktopRuntime } from './runtime.js'

const configuredBase = (import.meta.env?.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')

/**
 * Resolve a backend path for both browser and packaged desktop builds.
 *
 * Browser builds leave VITE_API_BASE_URL empty and continue using the same-origin
 * `/api` reverse proxy. The Tauri build injects the deployed server origin.
 */
export function apiUrl(path) {
  const runtimeBase = isDesktopRuntime() ? configuredBase : ''
  if (!path) return runtimeBase || '/'
  if (/^https?:\/\//i.test(path)) return path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${runtimeBase}${normalizedPath}`
}

export function apiOrigin() {
  return (isDesktopRuntime() ? configuredBase : '') || window.location.origin
}
