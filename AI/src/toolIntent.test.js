import test from 'node:test'
import assert from 'node:assert/strict'

import { fallbackToolIntent, normalizeToolIntent } from './toolIntent.js'

test('accepts only confirmed allowlisted desktop tool proposals', () => {
  const intent = normalizeToolIntent({
    tool: 'open_application',
    arguments: { target: '  Visual   Studio Code  ' },
    title: '<img src=x onerror=alert(1)>',
    requiresConfirmation: true
  })

  assert.equal(intent.tool, 'open_application')
  assert.equal(intent.arguments.target, 'Visual Studio Code')
  assert.equal(intent.title, '打开本机应用')
  assert.equal(normalizeToolIntent({ tool: 'open_application', arguments: { target: '微信' } }).tool, 'none')
  assert.equal(normalizeToolIntent({ tool: 'run_shell', requiresConfirmation: true }).tool, 'none')
})

test('rejects paths and shell-like application targets', () => {
  for (const target of ['C:\\Windows\\cmd.exe', '../tool.exe', 'notepad & calc', 'a;b']) {
    assert.equal(normalizeToolIntent({
      tool: 'open_application',
      arguments: { target },
      requiresConfirmation: true
    }).tool, 'none')
  }
})

test('normalizes window inspection and supports safe local fallback', () => {
  const intent = normalizeToolIntent({
    tool: 'inspect_current_window',
    arguments: { invented: 'ignored' },
    requiresConfirmation: true
  })
  assert.deepEqual(intent.arguments, {})
  assert.equal(intent.title, '查看当前窗口')

  assert.equal(fallbackToolIntent({ target: '微信' }, false).tool, 'open_application')
  assert.equal(fallbackToolIntent(null, true).tool, 'inspect_current_window')
  assert.equal(fallbackToolIntent(null, false).tool, 'none')
})
