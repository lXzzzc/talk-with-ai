import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { decodePcm16, formatCallDuration, playedSampleCount, voiceSocketUrl } from './voiceProtocol.js'

test('voice URL preserves API prefix and uses encrypted websockets for HTTPS', () => {
  assert.equal(voiceSocketUrl('/api/voice/realtime', 'http://127.0.0.1:5173'), 'ws://127.0.0.1:5173/api/voice/realtime')
  assert.equal(voiceSocketUrl('https://example.com/api/voice/realtime', 'http://localhost:5173'), 'wss://example.com/api/voice/realtime')
  assert.throws(() => voiceSocketUrl('file:///test', 'http://localhost'))
})

test('decodes little-endian signed PCM and rejects truncated samples', () => {
  const raw = Buffer.alloc(6)
  raw.writeInt16LE(-32768, 0); raw.writeInt16LE(0, 2); raw.writeInt16LE(32767, 4)
  assert.deepEqual([...decodePcm16(raw.toString('base64'))], [-1, 0, 32767 / 32768])
  assert.throws(() => decodePcm16('AQ=='))
})

test('playback receipts exclude scheduling gaps and unplayed future audio', () => {
  const segments = [{ start: 1, end: 2, samples: 24000 }, { start: 3, end: 4, samples: 24000 }]
  assert.equal(playedSampleCount(segments, 0), 0)
  assert.equal(playedSampleCount(segments, 1.5), 12000)
  assert.equal(playedSampleCount(segments, 2.9), 24000)
  assert.equal(playedSampleCount(segments, 3.5), 36000)
  assert.equal(playedSampleCount(segments.slice(1), 3.5, 24000), 36000)
  assert.equal(formatCallDuration(65.8), '01:05')
})

test('capture worklet resamples 48 kHz across render blocks without losing duration', () => {
  let Processor
  const sandbox = { AudioWorkletProcessor: class { constructor() { this.port = { postMessage: data => frames.push(data) } } },
    sampleRate: 48000, registerProcessor: (name, value) => { Processor = value } }
  const frames = []
  vm.runInNewContext(readFileSync(new URL('../public/voice-audio-worklet.js', import.meta.url), 'utf8'), sandbox)
  const processor = new Processor()
  for (let i = 0; i < 375; i++) processor.process([[new Float32Array(128).fill(0.25)]])
  const sampleCount = frames.reduce((sum, item) => sum + item.pcm.byteLength / 2, 0) + processor.frame.length
  assert.ok(Math.abs(sampleCount - 16000) <= 2)
  assert.ok(frames.every(item => item.pcm.byteLength === 1280 && Math.abs(item.level - 0.25) < 0.001))
})
