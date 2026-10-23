const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveApiPathMode, rewriteApiRequestUrl } = require('./proxy-routing.cjs')

test('auto mode treats the documented localhost Spring service as direct backend', () => {
  const mode = resolveApiPathMode(new URL('http://localhost:8080'))
  assert.equal(mode, 'spring')
  assert.equal(rewriteApiRequestUrl('/api/ai/chat?stream=true', mode), '/ai/chat?stream=true')
  assert.equal(rewriteApiRequestUrl('/api/voice/realtime', mode), '/voice/realtime')
})

test('auto mode preserves the API prefix for the deployed gateway', () => {
  const mode = resolveApiPathMode(new URL('https://ai.example.com'))
  assert.equal(mode, 'gateway')
  assert.equal(rewriteApiRequestUrl('/api/ai/chat', mode), '/api/ai/chat')
})

test('explicit path mode supports nonstandard direct backends and local gateways', () => {
  assert.equal(resolveApiPathMode(new URL('https://spring.example.com'), 'spring'), 'spring')
  assert.equal(resolveApiPathMode(new URL('http://localhost:8080'), 'gateway'), 'gateway')
  assert.throws(
    () => resolveApiPathMode(new URL('https://ai.example.com'), 'invalid'),
    /只能是 auto、gateway 或 spring/
  )
})
