const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * Resolve whether Electron's local proxy should remove the public `/api` prefix.
 * Public Nginx gateways retain it; a Spring service reached directly does not.
 */
function resolveApiPathMode(target, configuredMode = '') {
  const mode = String(configuredMode || '').trim().toLowerCase()
  if (mode && !['auto', 'gateway', 'spring'].includes(mode)) {
    throw new Error('TALK_AI_DESKTOP_API_PATH_MODE 只能是 auto、gateway 或 spring')
  }
  if (mode === 'gateway') return 'gateway'
  if (mode === 'spring') return 'spring'

  // The documented local backend runs Spring directly on localhost:8080.
  // All other targets default to the deployed gateway contract.
  return LOOPBACK_HOSTS.has(target.hostname) && target.port === '8080' ? 'spring' : 'gateway'
}

function rewriteApiRequestUrl(rawUrl, mode) {
  if (mode !== 'spring') return rawUrl
  const url = new URL(rawUrl || '/', 'http://127.0.0.1')
  if (url.pathname === '/api') url.pathname = '/'
  else if (url.pathname.startsWith('/api/')) url.pathname = url.pathname.slice(4)
  return `${url.pathname}${url.search}`
}

module.exports = { resolveApiPathMode, rewriteApiRequestUrl }
