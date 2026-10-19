import { isTauri } from '@tauri-apps/api/core'

/**
 * Tauri exposes both `isTauri` and its IPC internals in the desktop WebView.
 * Checking both keeps runtime detection reliable across dev and packaged builds.
 */
export function isDesktopRuntime() {
  return isTauri() || Boolean(globalThis.__TAURI_INTERNALS__)
}
