import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { VIDEO_PET_ROOT, pickPetAction, validatePetManifest } from './videoPetActions.js'

const assetRoot = new URL(`../public${VIDEO_PET_ROOT}`, import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', assetRoot), 'utf8'))

test('published pack has complete pools and only approved, existing assets', () => {
  assert.equal(validatePetManifest(manifest), manifest)
  assert.equal(Object.keys(manifest.actions).length, 8)
  for (const action of Object.values(manifest.actions)) assert.ok(existsSync(new URL(action.file, assetRoot)))
  assert.ok(!Object.values(manifest.actions).some(action => /羞涩|欢喜/.test(action.label)))
})

test('ambient weights favour idle but allow every available gesture', () => {
  assert.equal(pickPetAction(manifest, 'ambient', () => 0), 'idle')
  assert.equal(pickPetAction(manifest, 'ambient', () => 0.699), 'idle')
  assert.equal(pickPetAction(manifest, 'ambient', () => 0.70), 'greeting')
  assert.equal(pickPetAction(manifest, 'ambient', () => 0.939), 'blessing')
  assert.equal(pickPetAction(manifest, 'ambient', () => 0.94), 'swing-diagonal')
  assert.equal(pickPetAction(manifest, 'ambient', () => 0.999), 'swing-diagonal')
})

test('click and speech gestures stay in their intended pools', () => {
  for (const pool of ['tap', 'speech']) {
    assert.equal(pickPetAction(manifest, pool, () => 0), 'care')
    assert.equal(pickPetAction(manifest, pool, () => 0.999), 'listen')
  }
})

test('invalid or missing actions cannot silently enter the animation scheduler', () => {
  const copy = () => structuredClone(manifest)
  const missing = copy(); missing.pools.tap[0].action = 'missing'
  assert.throws(() => validatePetManifest(missing), /动作池无效/)
  const unsafe = copy(); unsafe.actions.idle.file = '../other.webm'
  assert.throws(() => validatePetManifest(unsafe), /素材路径无效/)
  const weights = copy(); weights.pools.ambient[0].weight = 0
  assert.throws(() => validatePetManifest(weights), /动作池无效/)
})
