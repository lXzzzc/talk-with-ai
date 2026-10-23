// Exercise production windows and IPC against a controlled local chat service.
// No prompts are sent to the user's real backend or written to their profile.
const { app, BrowserWindow, dialog, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const cp = require('node:child_process')
const assert = require('node:assert/strict')
const output = path.resolve(__dirname, '../../reports/video-pet/interactions')
fs.mkdirSync(output, { recursive: true })
const profile = path.join(output, 'user-data')
fs.mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
const disabledRun = process.argv.includes('--disabled')
const automaticRun = process.argv.includes('--automatic')
if (!disabledRun) fs.writeFileSync(path.join(profile, 'startup-preferences.json'), '{"disabled":false}')
dialog.showErrorBox = (title, message) => { console.error(title, message); app.exit(1) }
const createServer = net.createServer
let instancePipe
net.createServer = function (...args) {
  const server = createServer.apply(this, args), listen = server.listen
  server.listen = function (...options) {
    if (typeof options[0] === 'string' && options[0].includes('com.xzzz.talkwithai.electron')) instancePipe = options[0] += '.interactions-' + process.pid
    return listen.apply(this, options)
  }
  return server
}
const execFile = cp.execFile
cp.execFile = function (file, args, ...rest) {
  if (file === 'powershell.exe' && args.some(arg => arg.includes('Get-StartApps'))) return {}
  return execFile.call(this, file, args, ...rest)
}
let cursor = { x: 500, y: 400 }
app.whenReady().then(() => { screen.getCursorScreenPoint = () => cursor })
let lastResponse, lastBody, requests = 0, failNext = false
const backend = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  if (pathname === '/api/ai/chat') {
    let body = ''
    req.on('data', data => { body += data })
    req.on('end', () => {
      requests++; lastBody = JSON.parse(body); lastResponse = res
      if (failNext) { failNext = false; res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"message":"测试服务暂不可用"}') }
      else { res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); res.write('我在，') }
    })
  } else if (pathname === '/api/getChatIds') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(lastBody ? [{ sessionId: lastBody.conversationId, title: '桌宠对话' }] : []))
  } else if (pathname.startsWith('/api/chat/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([
      { role: 'user', content: '今天有些累，想和你聊聊。' },
      { role: 'assistant', content: '我在，慢慢说，我会陪着你。' }
    ]))
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('[]')
  }
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, name) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await sleep(75) }
  console.error(BrowserWindow.getAllWindows().map(win => ({id:win.id,title:win.getTitle(),url:win.webContents.getURL(),visible:win.isVisible()})))
  throw new Error('Timed out: ' + name)
}
const find = view => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('view=' + view))
const js = (win, expression) => win.webContents.executeJavaScript(expression)
async function shot(win, name) { fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()) }
async function input(win, value) {
  await js(win, `(() => { const el=document.querySelector('textarea'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('input',{bubbles:true})); })()`)
}
async function clickPet(pet, count = 1) {
  pet.webContents.sendInputEvent({ type: 'mouseDown', x: 170, y: 170, button: 'left', clickCount: count })
  await sleep(65)
  pet.webContents.sendInputEvent({ type: 'mouseUp', x: 170, y: 170, button: 'left', clickCount: count })
}

backend.listen(0, '127.0.0.1', () => {
  process.env.TALK_AI_DESKTOP_API_URL = `http://127.0.0.1:${backend.address().port}`
  const bundle = process.argv.find(arg => arg.startsWith('--bundle='))?.slice('--bundle='.length)
  require(bundle ? path.join(path.resolve(bundle), 'electron/main.cjs') : '../../electron/main.cjs')
  app.whenReady().then(async () => {
    await until(() => find('desktop-pet'), 'pet created')
    const pet = find('desktop-pet')
    const main = BrowserWindow.getAllWindows().find(win => win !== pet && !win.webContents.getURL().includes('view=splash'))
    if (!disabledRun) {
      await until(() => find('splash')?.isVisible(), 'welcome visible')
      const splash = find('splash')
      assert.equal(main.isVisible(), false)
      await sleep(850)
      await shot(splash, 'welcome')
      if (!automaticRun) await js(splash, `document.querySelector('input').click();document.querySelector('button').click()`)
      await until(() => main.isVisible() && pet.isVisible() && !find('splash'), 'skip reveals prepared windows')
      assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'startup-preferences.json'))).disabled, !automaticRun)
    } else {
      await until(() => main.isVisible() && pet.isVisible(), 'disabled welcome bypassed')
      assert.equal(find('splash'), undefined)
      const stored = JSON.parse(fs.readFileSync(path.join(output, 'persisted.json'), 'utf8'))
      assert.equal(await js(main, `localStorage.getItem('spring-ai-test-user-id')`), stored.userId)
      assert.equal(await js(main, `localStorage.getItem(${JSON.stringify(stored.historyKey)})`), stored.history)
      console.log('PASS: saved preference bypasses welcome on next launch')
      app.quit(); return
    }
    await js(main, `Object.keys(localStorage).filter(key=>key.startsWith('xilian-pet-history:')||key.startsWith('xilian-pet-session:')).forEach(key=>localStorage.removeItem(key))`)
    await until(() => js(pet, `!!document.querySelector('.video-pet-layer.is-active')`), 'pet decoded')
    await clickPet(pet)
    await until(() => find('pet-chat')?.isVisible(), 'single tap response')
    const bubble = find('pet-chat')
    assert.equal(await js(bubble, `document.querySelector('.pet-bubble').dataset.mode`), 'response')
    await shot(bubble, 'tap-response')
    await clickPet(pet, 1); await sleep(50); await clickPet(pet, 2)
    await until(() => js(bubble, `document.querySelector('.pet-bubble').dataset.mode === 'chat'`), 'double click chat')
    await sleep(350)
    assert.equal(await js(bubble, `document.querySelector('.pet-bubble').dataset.mode`), 'chat')
    await input(bubble, '今天有些累，想和你聊聊。')
    await until(() => js(pet, `document.querySelector('.video-pet-stage').dataset.state === 'typing' && document.querySelector('.video-pet-stage').dataset.action === 'listen'`), 'typing listens')
    await js(bubble, `document.querySelector('form').requestSubmit()`)
    await until(() => requests === 1, 'chat POST')
    const mainUser = await js(main, `localStorage.getItem('spring-ai-test-user-id')`)
    assert.equal(lastBody.userId, mainUser)
    assert.match(lastBody.conversationId, /^pet-/)
    await until(() => js(pet, `document.querySelector('.video-pet-stage').dataset.state === 'thinking'`), 'request thinking')
    await until(() => js(bubble, `document.querySelector('.bubble-messages').textContent.includes('我在，')`), 'streamed text')
    lastResponse.end('慢慢说，我会陪着你。')
    await until(() => js(bubble, `!document.querySelector('.bubble-stop') && document.querySelector('.bubble-messages').textContent.includes('慢慢说，我会陪着你。')`), 'reply complete')
    await until(() => js(pet, `document.querySelector('.video-pet-stage').dataset.state === 'idle'`), 'idle after reply')
    await shot(bubble, 'bubble-chat')
    await js(bubble, `document.querySelector('.bubble-footer button').click()`)
    await until(() => js(main, `document.querySelector('.app').textContent.includes('我在，慢慢说，我会陪着你。')`), 'open complete conversation')
    await js(pet, `window.speechTest = new BroadcastChannel('xilian-pet-speech-v1');speechTest.postMessage({type:'speech',owner:'smoke',active:true})`)
    await until(() => js(pet, `document.querySelector('.video-pet-stage').dataset.state === 'speaking' && document.querySelector('.video-pet-stage').dataset.action === 'care'`), 'speech action')
    await js(pet, `speechTest.postMessage({type:'speech',owner:'smoke',active:false});speechTest.close()`)
    await input(bubble, '取消测试')
    await js(bubble, `document.querySelector('form').requestSubmit()`)
    await until(() => requests === 2, 'cancel request started')
    await js(bubble, `document.querySelector('.bubble-stop').click()`)
    await until(() => js(bubble, `!document.querySelector('.bubble-stop')`), 'cancel completes')
    await until(() => js(pet, `document.querySelector('.video-pet-stage').dataset.state === 'idle'`), 'cancel clears activity')
    failNext = true
    await input(bubble, '故障测试')
    await js(bubble, `document.querySelector('form').requestSubmit()`)
    await until(() => js(bubble, `document.querySelector('.bubble-error')?.textContent.includes('测试服务暂不可用') && !document.querySelector('.bubble-stop')`), 'error recovers')
    await js(bubble, `document.querySelector('[aria-label="关闭气泡"]').click()`)
    await until(() => !bubble.isVisible(), 'bubble closed')
    const before = pet.getPosition()
    pet.webContents.sendInputEvent({ type: 'mouseDown', x: 170, y: 170, button: 'left', clickCount: 1 })
    await sleep(120)
    cursor = { x: 460, y: 370 }
    await until(() => pet.getPosition()[0] !== before[0], 'drag moves window')
    pet.webContents.sendInputEvent({ type: 'mouseUp', x: 170, y: 170, button: 'left', clickCount: 1 })
    await sleep(400)
    assert.equal(bubble.isVisible(), false, 'drag must not trigger a tap response')
    assert.ok(pet.getPosition()[0] < before[0])
    await js(pet, `document.querySelector('[title="打开气泡对话"]').click()`)
    await until(() => bubble.isVisible(), 'reopen bubble')
    assert.ok(await js(bubble, `document.querySelector('.bubble-messages').textContent.includes('慢慢说，我会陪着你。')`))
    pet.hide()
    await until(() => !bubble.isVisible(), 'hide pet hides bubble')
    await new Promise((resolve, reject) => {
      const socket = net.connect(instancePipe)
      socket.on('error', reject)
      socket.on('connect', () => { socket.resume(); socket.end('show') })
      socket.on('close', resolve)
    })
    await until(() => pet.isVisible() && main.isVisible(), 'relaunch restores windows')
    assert.equal(BrowserWindow.getAllWindows().length, 3)
    const historyKey = `xilian-pet-history:${mainUser}`
    fs.writeFileSync(path.join(output, 'persisted.json'), JSON.stringify({ userId: mainUser, historyKey,
      history: await js(bubble, `localStorage.getItem(${JSON.stringify(historyKey)})`) }))
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({
      splash: true, skip: !automaticRun, automaticSplash: automaticRun, savedPreference: true, tap: true, doubleClick: true,
      sharedIdentity: true, streamingChat: true, typing: true, thinking: true, speech: true,
      cancellation: true, failureRecovery: true, dragDoesNotTap: true, bubbleFollowsLifecycle: true, openFullConversation: true, relaunch: true
    }, null, 2))
    console.log('PASS: real windows, welcome, click, double click, drag, chat, activity, cancel and failure recovery')
    app.quit()
  }).catch(error => { console.error(error); app.exit(1) })
})
app.on('will-quit', () => backend.close())
setTimeout(() => { console.error('Interaction smoke exceeded time budget'); app.exit(1) }, 90000).unref()
