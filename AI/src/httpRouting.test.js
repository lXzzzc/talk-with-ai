import test from 'node:test'
import assert from 'node:assert/strict'
import { withUserId } from './httpRouting.js'

test('user identity keeps local API URLs relative and encodes the query safely', () => {
  assert.equal(withUserId('/api/chat/test?other=1', 'u +&中', 'http://localhost:5173'),
    '/api/chat/test?other=1&userId=u+%2B%26%E4%B8%AD')
  assert.equal(withUserId('https://example.com/api/chat/test', 'u', 'http://localhost:5173'),
    'https://example.com/api/chat/test?userId=u')
})
