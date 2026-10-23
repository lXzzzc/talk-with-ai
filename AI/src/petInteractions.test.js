import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveChatUser } from './chatIdentity.js'
import { resolvePetActivity } from './petActivity.js'
import { streamPetReply } from './petChatClient.js'

test('pet and main chat share the same user and retain legacy history ownership', () => {
  const map = new Map([['spring-ai-test-conversations', '[]']])
  const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) }
  assert.equal(resolveChatUser(storage), 'default')
  assert.equal(resolveChatUser(storage), 'default')
  map.set('spring-ai-test-user-id', 'existing-user')
  assert.equal(resolveChatUser(storage), 'existing-user')
})
test('request activity takes priority over typing and clears back to idle', () => {
  assert.equal(resolvePetActivity(['typing', 'thinking']), 'thinking')
  assert.equal(resolvePetActivity(['typing', 'listening']), 'listening')
  assert.equal(resolvePetActivity([]), 'idle')
})
test('bubble chat uses POST and decodes Chinese split across network chunks', async t => {
  const originalFetch = globalThis.fetch, originalStorage = globalThis.localStorage
  t.after(() => { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage })
  globalThis.localStorage = { getItem: () => null }
  const bytes = new TextEncoder().encode('我在，慢慢说。')
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/ai/chat')
    assert.equal(options.method, 'POST')
    assert.equal(JSON.parse(options.body).userId, 'test-user')
    assert.equal(JSON.parse(options.body).conversationId, 'pet-test')
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 2)); controller.enqueue(bytes.slice(2, 7))
      controller.enqueue(bytes.slice(7)); controller.close()
    } }))
  }
  let latest
  const text = await streamPetReply({ userId: 'test-user', conversationId: 'pet-test', prompt: '你好', onText: value => { latest = value } })
  assert.equal(text, '我在，慢慢说。')
  assert.equal(latest, text)
  globalThis.fetch = async () => new Response(JSON.stringify({ message: '服务暂时不可用' }), { status: 503 })
  await assert.rejects(streamPetReply({ prompt: '再试试', onText() {} }), /服务暂时不可用/)
})
