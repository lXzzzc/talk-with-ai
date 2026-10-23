const test = require('node:test')
const assert = require('node:assert/strict')
const { bubblePosition, dragPosition } = require('./pet-geometry.cjs')
test('bubble stays beside the pet and inside a display with negative coordinates', () => {
  const area = { x: -1920, y: -200, width: 1920, height: 1080 }
  const position = bubblePosition({ x: -400, y: 500, width: 340, height: 390 }, { width: 360, height: 470 }, area)
  assert.deepEqual(position, { x: -770, y: 410 })
  const right = bubblePosition({ x: -1910, y: -100, width: 340, height: 390 }, { width: 360, height: 470 }, area)
  assert.deepEqual(right, { x: -1560, y: -80 })
})
test('a small movement remains a tap while a real drag is clamped to the display', () => {
  const start = { cursor: { x: 800, y: 500 }, bounds: { x: 650, y: 400, width: 340, height: 390 } }
  const area = { x: 0, y: 0, width: 1280, height: 800 }
  assert.equal(dragPosition(start, { x: 803, y: 503 }, area).dragged, false)
  assert.deepEqual(dragPosition(start, { x: 1600, y: 1300 }, area), { dragged: true, x: 940, y: 410 })
})
