import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const tauriHost = process.env.TAURI_DEV_HOST
const configuredProxyTarget = (process.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
const proxyTarget = configuredProxyTarget || 'http://localhost:8080'
const proxyUsesApiPrefix = Boolean(configuredProxyTarget)

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: tauriHost || '0.0.0.0',
    hmr: tauriHost
      ? {
          protocol: 'ws',
          host: tauriHost,
          port: 1421
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**']
    },
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        rewrite: proxyUsesApiPrefix ? undefined : (path) => path.replace(/^\/api/, ''),
        configure(proxy) {
          // The browser talks to Vite as a same-origin endpoint. Do not forward
          // its localhost Origin to the deployed API and trigger remote CORS.
          proxy.on('proxyReq', (proxyRequest) => proxyRequest.removeHeader('origin'))
        }
      }
    }
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'es2022',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG
  }
})
