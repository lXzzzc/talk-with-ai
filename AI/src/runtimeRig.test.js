import test from 'node:test'
import assert from 'node:assert/strict'
import {
  actionEnvelope,
  replacementEyeOpen,
  runtimeBlinkOpen,
  smoothstep
} from './live2d/runtimeRig.js'

test('runtime blink closes and reopens without leaving both eye states visible', () => {
  assert.equal(runtimeBlinkOpen(0), 1)
  assert.equal(runtimeBlinkOpen(105), 0)
  assert.equal(runtimeBlinkOpen(180), 1)
  assert.equal(runtimeBlinkOpen(1000), 1)
})

test('smoothstep clamps opacity transitions', () => {
  assert.equal(smoothstep(0.2, 0.6, 0), 0)
  assert.equal(smoothstep(0.2, 0.6, 1), 1)
  assert.ok(smoothstep(0.2, 0.6, 0.4) > 0.49)
})

test('replacement eye states are strictly exclusive', () => {
  assert.equal(replacementEyeOpen(0), 0)
  assert.equal(replacementEyeOpen(0.43), 0)
  assert.equal(replacementEyeOpen(0.44), 1)
  assert.equal(replacementEyeOpen(1), 1)
})

test('action envelope eases from rest and returns to rest', () => {
  assert.equal(actionEnvelope(0), 0)
  assert.ok(actionEnvelope(0.5) > 0.99)
  assert.ok(actionEnvelope(1) < 1e-12)
})
