import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const configuredProxyTarget = (process.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
const proxyTarget = configuredProxyTarget || 'http://localhost:8080'
const proxyUsesApiPrefix = Boolean(configuredProxyTarget)

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: proxyTarget,
        ws: true,
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
  envPrefix: ['VITE_'],
  build: {
    target: 'es2022'
  }
})
