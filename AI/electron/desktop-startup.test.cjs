const test = require('node:test')
const assert = require('node:assert/strict')
const { startDesktopWindows, showDesktopWindows } = require('./desktop-startup.cjs')

test('desktop startup shows the client and pet even when application discovery never completes', async () => {
  const calls = []
  let finish
  const discovery = new Promise(resolve => { finish = resolve })
  const pending = startDesktopWindows({
    createMainWindow: () => calls.push('client'),
    createPetWindow: () => calls.push('pet'),
    createTray: () => calls.push('tray'),
    refreshCatalog: () => { calls.push('catalog'); return discovery },
    onCatalogError: () => assert.fail('unexpected error')
  })
  assert.deepEqual(calls, ['client', 'pet', 'tray'])
  await Promise.resolve()
  assert.deepEqual(calls, ['client', 'pet', 'tray', 'catalog'])
  finish()
  await pending
})

test('failed application discovery is reported without closing the client or pet', async () => {
  const error = new Error('discovery unavailable')
  const calls = []
  await startDesktopWindows({
    createMainWindow: () => calls.push('client'), createPetWindow: () => calls.push('pet'),
    createTray: () => calls.push('tray'), refreshCatalog: () => { throw error },
    onCatalogError: value => { assert.equal(value, error); calls.push('reported') }
  })
  assert.deepEqual(calls, ['client', 'pet', 'tray', 'reported'])
})

test('launching the client again restores its pet as well as the main window', () => {
  const calls = []
  showDesktopWindows({ focusMainWindow: () => calls.push('client'), createPetWindow: () => calls.push('pet') })
  assert.deepEqual(calls, ['client', 'pet'])
})
