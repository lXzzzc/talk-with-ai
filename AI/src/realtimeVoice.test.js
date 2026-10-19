import test from 'node:test'
import assert from 'node:assert/strict'
import { RealtimeVoiceCall } from './realtimeVoice.js'

function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  })
}

test('hanging up while microphone permission is pending stops tracks when permission resolves', async t => {
  let grant
  let stopped = 0
  let closed = 0
  const pending = new Promise(resolve => { grant = resolve })
  replaceGlobal(t, 'navigator', { mediaDevices: { getUserMedia: () => pending } })
  replaceGlobal(t, 'AudioWorkletNode', class {})
  replaceGlobal(t, 'AudioContext', class {
    state = 'running'
    resume() { return Promise.resolve() }
    close() { this.state = 'closed'; closed++; return Promise.resolve() }
  })
  const call = new RealtimeVoiceCall({ context: {}, onEvent() {} })
  const starting = call.start()
  await Promise.resolve()
  call.stop()
  grant({ getTracks: () => [{ stop() { stopped++ } }] })
  await starting
  assert.equal(stopped, 1)
  assert.equal(closed, 1)
  assert.equal(call.stopped, true)
})

test('audio worklet initialization failure closes microphone and audio context', async t => {
  let stopped = 0
  let closed = 0
  replaceGlobal(t, 'navigator', { mediaDevices: { getUserMedia: async () => ({
    getTracks: () => [{ stop() { stopped++ } }]
  }) } })
  replaceGlobal(t, 'AudioWorkletNode', class {})
  replaceGlobal(t, 'AudioContext', class {
    state = 'running'
    audioWorklet = { addModule: async () => { throw new Error('worklet failed') } }
    resume() { return Promise.resolve() }
    close() { this.state = 'closed'; closed++; return Promise.resolve() }
  })
  const call = new RealtimeVoiceCall({ context: {}, onEvent() {} })
  await assert.rejects(call.start(), /worklet failed/)
  assert.equal(stopped, 1)
  assert.equal(closed, 1)
})
