import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldCaptureCurrentWindow } from './screenIntent.js'

test('recognizes explicit requests about the current screen', () => {
  for (const prompt of [
    '你觉得这个怎么样',
    '帮我看看这个',
    '这个是怎么回事？',
    '看看当前页面有什么问题',
    '解释一下这个报错',
    '屏幕上的按钮为什么点不了',
    'What do you think of this?',
    'Look at this screen and explain the error'
  ]) {
    assert.equal(shouldCaptureCurrentWindow(prompt), true, prompt)
  }
})

test('does not capture for ordinary or explicitly textual conversation', () => {
  for (const prompt of [
    '',
    '今天天气怎么样',
    '你觉得这个方案怎么样',
    '帮我看看这段代码',
    '这个问题应该怎么解决',
    '给我讲一个故事',
    '打开 QQ'
  ]) {
    assert.equal(shouldCaptureCurrentWindow(prompt), false, prompt)
  }
})
