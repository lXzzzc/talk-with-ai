import test from 'node:test'
import assert from 'node:assert/strict'
import { wallpaperRenderSize } from './wallpaperRendering.js'

test('high DPI backgrounds avoid rendering redundant retina pixels', () => {
  assert.deepEqual(wallpaperRenderSize(1500, 900, 1.5), { width: 1500, height: 900 })
  assert.deepEqual(wallpaperRenderSize(1500, 900, 2), { width: 1500, height: 900 })
})
test('large screens stay within the background pixel budget without changing aspect ratio', () => {
  const size = wallpaperRenderSize(3840, 2160, 2)
  assert.deepEqual(size, { width: 1920, height: 1080 })
  const portrait = wallpaperRenderSize(1000, 4000, 1)
  assert.ok(portrait.width * portrait.height < 2080000)
  assert.ok(Math.abs(portrait.width / portrait.height - 0.25) < 0.001)
})
test('temporarily hidden or zero-size stages still get a valid drawing buffer', () => {
  assert.deepEqual(wallpaperRenderSize(0, 0), { width: 1, height: 1 })
})
