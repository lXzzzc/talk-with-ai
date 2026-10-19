import assert from 'node:assert/strict'
import test from 'node:test'
import { selectSupportedAudioMimeType } from './voiceInput.js'

test('prefers opus in a webm container for push-to-talk', () => {
  assert.equal(
    selectSupportedAudioMimeType((type) => type === 'audio/webm;codecs=opus'),
    'audio/webm;codecs=opus'
  )
})

test('falls back when the preferred audio container is unavailable', () => {
  assert.equal(selectSupportedAudioMimeType((type) => type === 'audio/ogg'), 'audio/ogg')
  assert.equal(selectSupportedAudioMimeType(() => false), '')
})
