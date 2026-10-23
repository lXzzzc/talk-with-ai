// Exercise the actual production Vue desktop-pet view in Electron, without a backend.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../../dist')
const reportDir = path.resolve(__dirname, '../../reports/video-pet')
fs.mkdirSync(reportDir, { recursive: true })
app.setPath('userData', path.join(reportDir, 'stage-user-data'))
app.disableHardwareAcceleration()
let server
let win
async function until(expression) {
  for (let i = 0; i < 200; i++) {
    if (await win.webContents.executeJavaScript(expression)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${expression}`)
}
app.whenReady().then(async () => {
  server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name))
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return }
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webm': 'video/webm', '.png': 'image/png' }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  win = new BrowserWindow({ width: 340, height: 390, show: false, transparent: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  const errors = []
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  await win.loadURL(`http://127.0.0.1:${server.address().port}/?view=desktop-pet`)
  await until(`document.querySelector('.video-pet-layer.is-active')?.videoWidth === 360`)
  const alpha = await win.webContents.executeJavaScript(`(() => {
    const v = document.querySelector('.video-pet-layer.is-active'), c = document.createElement('canvas');
    c.width = c.height = 360; const ctx = c.getContext('2d'); ctx.drawImage(v,0,0);
    const d = ctx.getImageData(0,0,360,360).data; let opaque=0;
    for(let i=3;i<d.length;i+=4) if(d[i]>240) opaque++;
    return {cornerAlpha:d[3],opaque,action:document.querySelector('.video-pet-stage').dataset.action};
  })()`)
  assert.equal(alpha.cornerAlpha, 0)
  assert.ok(alpha.opaque > 10000)
  assert.equal(alpha.action, 'idle')
  await win.webContents.executeJavaScript(`document.querySelector('[title="温柔回应"]').click()`)
  await until(`['care','listen'].includes(document.querySelector('.video-pet-stage').dataset.action)`)
  // A real media ended event must return a temporary gesture to the ambient pool.
  await win.webContents.executeJavaScript(`document.querySelector('.video-pet-layer.is-active').dispatchEvent(new Event('ended'))`)
  await until(`document.querySelector('.video-pet-layer.is-active').currentTime < 1`)
  await win.webContents.executeJavaScript(`window.testSpeech = new BroadcastChannel('xilian-pet-speech-v1'); window.testSpeech.postMessage({type:'speech',owner:'integration-smoke',active:true})`)
  await until(`['care','listen'].includes(document.querySelector('.video-pet-stage').dataset.action)`)
  await win.webContents.executeJavaScript(`window.testSpeech.postMessage({type:'speech',owner:'integration-smoke',active:false})`)
  await until(`document.querySelector('.video-pet-stage').dataset.action === 'idle'`)
  await win.webContents.executeJavaScript(`const s=document.querySelector('select');s.value='blessing';s.dispatchEvent(new Event('change',{bubbles:true}))`)
  await until(`document.querySelector('.video-pet-stage').dataset.action === 'blessing'`)
  await win.webContents.executeJavaScript(`(() => { const s=document.querySelector('select');s.value='swing-diagonal';s.dispatchEvent(new Event('change',{bubbles:true})) })()`)
  await until(`document.querySelector('.video-pet-stage').dataset.action === 'swing-diagonal'`)
  const swing = await win.webContents.executeJavaScript(`(() => {
    const v=document.querySelector('.video-pet-layer.is-active'), c=document.createElement('canvas');
    c.width=c.height=360; const ctx=c.getContext('2d');ctx.drawImage(v,0,0);
    const d=ctx.getImageData(0,0,360,360).data;let opaque=0,green=0;
    for(let i=0;i<d.length;i+=4) { if(d[i+3]>240) opaque++;if(d[i+3]>128 && d[i+1]-Math.max(d[i],d[i+2])>75) green++; }
    return {width:v.videoWidth,height:v.videoHeight,duration:v.duration,cornerAlpha:d[3],opaque,green};
  })()`)
  assert.equal(swing.width, 360)
  assert.equal(swing.height, 360)
  assert.equal(swing.cornerAlpha, 0)
  assert.ok(swing.opaque > 10000)
  assert.equal(swing.green, 0)
  assert.ok(Math.abs(swing.duration - 10) < 0.1)
  await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
  fs.writeFileSync(path.join(reportDir, 'swing-stage.png'), (await win.webContents.capturePage()).toPNG())
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await until(`getComputedStyle(document.querySelector('.video-pet-poster')).display !== 'none' && !document.querySelector('.video-pet-layer.is-active')`)
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await until(`document.querySelector('.video-pet-stage').dataset.action === 'idle' && !!document.querySelector('.video-pet-layer.is-active')`)
  win.webContents.debugger.detach()
  fs.mkdirSync(reportDir, { recursive: true })
  fs.writeFileSync(path.join(reportDir, 'integrated-stage.png'), (await win.webContents.capturePage()).toPNG())
  assert.deepEqual(errors, [])
  fs.writeFileSync(path.join(reportDir, 'stage-smoke.json'), JSON.stringify({alpha, swing, click:true, speech:true, manualAction:true, reducedMotion:true, errors}, null, 2))
  console.log('PASS: production stage, real alpha, click, speech, manual selection and reduced motion')
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  win?.destroy()
  server?.close()
  app.exit(process.exitCode || 0)
})

