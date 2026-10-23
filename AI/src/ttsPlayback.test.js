import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { playBlob } from './tts.js'

const originals = {
  Audio: globalThis.Audio, BroadcastChannel: globalThis.BroadcastChannel,
  setInterval: globalThis.setInterval,
  createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL
}
const messages = []
const audios = []
class TestAudio {
  constructor() { audios.push(this); this.paused = false }
  play() { return Promise.resolve() }
  pause() { this.paused = true }
}
globalThis.Audio = TestAudio
globalThis.BroadcastChannel = class {
  postMessage(message) { messages.push(message) }
  close() {}
}
globalThis.setInterval = () => 0
URL.createObjectURL = () => 'blob:test-audio'
URL.revokeObjectURL = () => {}

const active = () => messages.filter(message => message.type === 'speech').at(-1)?.active

test('pet speech starts on actual audio playback and stops on ended', async () => {
  const done = playBlob(new Blob(['test']))
  const audio = audios.at(-1)
  assert.notEqual(active(), true)
  audio.onplaying()
  assert.equal(active(), true)
  audio.onended()
  await done
  assert.equal(active(), false)
})

test('overlapping playback keeps pet speaking until both audio clips end', async () => {
  const first = playBlob(new Blob(['a']))
  const a = audios.at(-1)
  const second = playBlob(new Blob(['b']))
  const b = audios.at(-1)
  a.onplaying()
  b.onplaying()
  a.onended()
  await first
  assert.equal(active(), true)
  b.onended()
  await second
  assert.equal(active(), false)
})

test('aborting playback clears pet speech and pauses audio', async () => {
  const controller = new AbortController()
  const done = playBlob(new Blob(['test']), { signal: controller.signal })
  const audio = audios.at(-1)
  audio.onplaying()
  controller.abort()
  await assert.rejects(done, { name: 'AbortError' })
  assert.equal(audio.paused, true)
  assert.equal(active(), false)
})

test('audio error clears pet speech', async () => {
  const done = playBlob(new Blob(['test']))
  const audio = audios.at(-1)
  audio.onplaying()
  audio.onerror()
  await assert.rejects(done, /Audio playback failed/)
  assert.equal(active(), false)
})

after(() => {
  globalThis.Audio = originals.Audio
  globalThis.BroadcastChannel = originals.BroadcastChannel
  globalThis.setInterval = originals.setInterval
  URL.createObjectURL = originals.createObjectURL
  URL.revokeObjectURL = originals.revokeObjectURL
})
