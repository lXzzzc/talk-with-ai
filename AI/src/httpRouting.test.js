import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldUseNativeHttp, withUserId } from './httpRouting.js'

test('desktop history and deletion stay on the local proxy even when an absolute URL is supplied', () => {
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
    assert.equal(shouldUseNativeHttp(`${origin}/api/getChatIds?userId=u`, true, origin), false)
    assert.equal(shouldUseNativeHttp(`${origin}/api/chat/test?userId=u`, true, origin), false)
    assert.equal(shouldUseNativeHttp('/api/chat/test?userId=u', true, origin), false)
  }
})

test('packaged desktop cross-origin requests still use the native HTTP plugin', () => {
  assert.equal(shouldUseNativeHttp('http://101.35.54.118/api/chat/test', true, 'http://tauri.localhost'), true)
  assert.equal(shouldUseNativeHttp('https://example.com/api/chat/test', true, 'http://localhost:5173'), true)
  assert.equal(shouldUseNativeHttp('https://example.com/api/chat/test', false, 'http://localhost:5173'), false)
})

test('user identity keeps local API URLs relative and encodes the query safely', () => {
  assert.equal(withUserId('/api/chat/test?other=1', 'u +&中', 'http://localhost:5173'),
    '/api/chat/test?other=1&userId=u+%2B%26%E4%B8%AD')
  assert.equal(withUserId('https://example.com/api/chat/test', 'u', 'http://localhost:5173'),
    'https://example.com/api/chat/test?userId=u')
})
