import test from 'node:test'
import assert from 'node:assert/strict'

import { parseOpenApplicationCommand } from './localCommands.js'

test('parses slash and natural-language open commands', () => {
  assert.equal(parseOpenApplicationCommand('/打开 计算器').target, '计算器')
  assert.equal(parseOpenApplicationCommand('请帮我打开一下任务管理器').target, '任务管理器')
  assert.equal(parseOpenApplicationCommand('打开 Windows 设置').target, 'windows 设置')
  assert.equal(parseOpenApplicationCommand('帮我打开微信').target, '微信')
})

test('does not treat ordinary chat as a local command', () => {
  assert.equal(parseOpenApplicationCommand('给我介绍一下计算器的历史'), null)
})

test('passes unknown application names to the native catalog without inventing an executable', () => {
  const command = parseOpenApplicationCommand('/打开 未知软件')
  assert.equal(command.type, 'open_application')
  assert.equal(command.target, '未知软件')
  assert.equal('application' in command, false)
})
