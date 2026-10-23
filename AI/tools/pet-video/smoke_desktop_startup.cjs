// Run the real desktop entry in an isolated instance and verify its pet lifecycle.
const { app, BrowserWindow, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const childProcess = require('node:child_process')
const assert = require('node:assert/strict')
const output = path.resolve(__dirname, '../../reports/video-pet')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(output, 'startup-user-data'))
app.disableHardwareAcceleration()
dialog.showErrorBox = (title, message) => { console.error(title, message); app.exit(1) }
// A separate pipe leaves the user's running client untouched.
const createServer = net.createServer
let pipe
net.createServer = function (...args) {
  const server = createServer.apply(this, args)
  const listen = server.listen
  server.listen = function (...options) {
    if (typeof options[0] === 'string' && options[0].includes('com.xzzz.talkwithai.electron')) {
      pipe = options[0] += '.startup-smoke-' + process.pid
    }
    return listen.apply(this, options)
  }
  return server
}
// Simulate an application scan that never completes. Startup must still show both windows.
const execFile = childProcess.execFile
childProcess.execFile = function (file, args, ...rest) {
  if (file === 'powershell.exe' && args.some(arg => arg.includes('Get-StartApps'))) return {}
  return execFile.call(this, file, args, ...rest)
}
require('../../electron/main.cjs')
async function until(check) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Desktop startup timed out')
}
app.whenReady().then(async () => {
  console.log('Startup smoke: Electron ready')
  await until(() => BrowserWindow.getAllWindows().some(win => win.webContents.getURL().includes('view=desktop-pet')))
  const pet = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('view=desktop-pet'))
  console.log('Startup smoke: pet window created')
  assert.ok(pet)
  await until(() => pet.isVisible())
  console.log('Startup smoke: pet visible')
  await until(() => pet.webContents.executeJavaScript(`!!document.querySelector('.video-pet-layer.is-active')`))
  console.log('Startup smoke: animation playing')
  const image = await pet.webContents.capturePage()
  fs.writeFileSync(path.join(output, 'automatic-startup.png'), image.toPNG())
  pet.hide()
  assert.equal(pet.isVisible(), false)
  await new Promise((resolve, reject) => {
    const socket = net.connect(pipe)
    socket.on('error', reject)
    socket.on('connect', () => { socket.resume(); socket.end('show') })
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Relaunch pipe timed out')) })
    socket.on('close', resolve)
  })
  await until(() => pet.isVisible())
  assert.equal(BrowserWindow.getAllWindows().length, 2)
  fs.writeFileSync(path.join(output, 'desktop-startup.json'), JSON.stringify({
    automaticPet: true, catalogDoesNotBlock: true, relaunchRestoresPet: true, noDuplicateWindows: true
  }, null, 2))
  console.log('PASS: actual desktop entry auto-starts the pet; relaunch restores it without duplicates')
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
app.on('will-quit', () => {
  const alive = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed())
  if (alive.length) { console.error('Windows survived quit'); app.exit(1) }
  console.log('PASS: desktop quit closes its pet window')
})

