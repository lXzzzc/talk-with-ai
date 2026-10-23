const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const output = path.resolve(__dirname, '../../reports/dialog')
const root = path.resolve(__dirname, '../../dist')
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(output, 'user-data'))
let win, server, resolveOpen
let fixture = 'one'
const opened = [], errors = []
const apps = [{ id: 'mock-qq', name: 'QQ', source: 'start_menu' }, { id: 'mock-qq-two', name: 'QQ · 另一个本机入口', source: 'manual' }]
ipcMain.handle('dialog-smoke', (_event, command, args) => {
  if (command === 'search_applications') return fixture === 'missing' ? [] : fixture === 'many' ? apps : [apps[0]]
  if (command === 'open_application') { opened.push(args.application); return new Promise(resolve => { resolveOpen = resolve }) }
  if (command === 'capture_active_window') throw new Error('Smoke test must never capture the desktop')
  return null
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const js = expression => win.webContents.executeJavaScript(expression)
async function until(expression) {
  for (let i=0;i<150;i++) { if (await js(expression)) return; await sleep(70) }
  throw new Error('Dialog timed out: '+expression)
}
async function prompt(text) {
  await js(`(() => {const input=document.querySelector('.composer textarea');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form.composer').requestSubmit()})()`)
  await until(`!!document.querySelector('.xilian-command-dialog')`)
  await until(`document.querySelector('.xilian-dialog-perch img').naturalWidth > 1000`)
}
async function screenshot(name, full = false) {
  await js(`Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation=>animation.finished.catch(()=>{})))`)
  await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
  await sleep(300)
  const rect = await js(`(() => { const r=document.querySelector('.xilian-command-dialog').getBoundingClientRect();return {x:Math.max(0,Math.floor(r.x-20)),y:Math.max(0,Math.floor(r.y-150)),width:Math.ceil(r.width+40),height:Math.ceil(r.height+175)} })()`)
  const result=await win.webContents.debugger.sendCommand('Page.captureScreenshot',full?{format:'png'}:{format:'png',clip:{...rect,scale:1}})
  fs.writeFileSync(path.join(output, name+'.png'),Buffer.from(result.data,'base64'))
}
function key(keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type:'keyDown',keyCode,modifiers })
  win.webContents.sendInputEvent({ type:'keyUp',keyCode,modifiers })
}
async function cancel() {
  key('Escape')
  await until(`!document.querySelector('.command-dialog')`)
  await sleep(100)
}
app.whenReady().then(async () => {
  server = http.createServer((req,res) => {
    const pathname = new URL(req.url,'http://localhost').pathname
    if (pathname.startsWith('/api/')) {
      if (pathname.endsWith('/tool-intent')) {
        let body='';req.on('data',data=>{body+=data});req.on('end',()=>{
          const screen = JSON.parse(body).prompt.includes('窗口')
          res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({tool:screen?'inspect_current_window':'open_application',requiresConfirmation:true,arguments:screen?{}:{target:'qq'}}))
        });return
      }
      if (pathname.endsWith('/ai/chat')) { res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('已经为你处理好了。'); return }
      res.writeHead(200,{'Content-Type':'application/json'}).end('[]');return
    }
    const file = path.resolve(root, '.'+(pathname==='/'?'/index.html':pathname))
    if (!file.startsWith(root+path.sep)||!fs.existsSync(file)) {res.writeHead(404).end();return}
    const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.atlas':'text/plain'}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res)
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  win = new BrowserWindow({width:1280,height:820,show:false,webPreferences:{preload:path.join(__dirname,'dialog-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`)
  win.showInactive()
  if (!win.isVisible()) win.showInactive()
  win.webContents.debugger.attach('1.3')
  await until(`!!document.querySelector('.composer textarea') && !!document.querySelector('[title="关闭自动朗读"]')`)
  await js(`document.querySelector('[title="关闭自动朗读"]').click();document.documentElement.dataset.theme='light'`)
  await prompt('打开QQ')
  assert.equal(opened.length,0)
  const layout=await js(`(() => {
    const d=document.querySelector('.xilian-command-dialog').getBoundingClientRect(),c=document.querySelector('.command-copy').getBoundingClientRect(),p=document.querySelector('.xilian-dialog-perch').getBoundingClientRect();
    return {top:p.top,card:d.top,characterBottom:p.bottom,copyTop:c.top,pointer:getComputedStyle(document.querySelector('.xilian-dialog-perch')).pointerEvents,focus:document.activeElement.className}
  })()`)
  assert.ok(layout.top>=0 && layout.top<layout.card)
  assert.ok(layout.characterBottom<layout.copyTop)
  assert.equal(layout.pointer,'none')
  assert.equal(layout.focus,'command-cancel')
  await screenshot('dialog-light')
  key('Tab',['shift'])
  await until(`document.activeElement.classList.contains('command-confirm')`)
  key('Tab')
  await until(`document.activeElement.classList.contains('command-cancel')`)
  await js(`document.documentElement.dataset.theme='dark'`)
  await screenshot('dialog-dark')
  await cancel()
  assert.equal(opened.length,0)
  fixture='many'
  await prompt('打开QQ')
  await js(`const picker=document.querySelector('.command-picker select');picker.value='mock-qq-two';picker.dispatchEvent(new Event('change',{bubbles:true}))`)
  await screenshot('dialog-choices')
  await js(`document.querySelector('.command-confirm').click()`)
  await until(`Array.from(document.querySelectorAll('.command-actions button')).every(button=>button.disabled)`)
  assert.deepEqual(opened,['mock-qq-two'])
  key('Escape')
  await sleep(100)
  assert.equal(await js(`!!document.querySelector('.xilian-command-dialog')`),true)
  resolveOpen(true)
  await until(`!document.querySelector('.command-dialog') && !document.querySelector('.send.stop')`)
  fixture='missing'
  await prompt('打开一个没有安装的软件')
  assert.equal(await js(`!!document.querySelector('.command-confirm')`),false)
  await screenshot('dialog-missing')
  await cancel()
  await prompt('查看当前窗口')
  await screenshot('dialog-screen')
  await cancel()
  fixture='one'
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:390,height:700,deviceScaleFactor:1,mobile:false})
  await js(`document.documentElement.dataset.theme='light'`)
  await prompt('打开QQ')
  await screenshot('dialog-narrow',true)
  assert.ok(await js(`document.querySelector('.xilian-dialog-perch').getBoundingClientRect().top>=0 && document.documentElement.scrollWidth<=390`))
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:800,height:450,deviceScaleFactor:1,mobile:false})
  await js(`document.querySelector('.command-confirm').scrollIntoView({block:'nearest'})`)
  assert.ok(await js(`document.querySelector('.command-confirm').getBoundingClientRect().bottom<=450`))
  win.webContents.debugger.detach()
  assert.deepEqual(errors,[])
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({mascotAboveCard:true,contentUnobstructed:true,decorationDoesNotIntercept:true,light:true,dark:true,narrow:true,shortWindow:true,keyboard:true,noLaunchBeforeConfirmation:true,multipleChoices:true,missingApp:true,screenDialog:true,busyCannotDismiss:true,errors},null,2))
  console.log('PASS: real confirmation dialogs, character framing, themes, responsive layout and safe action controls')
}).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{win?.destroy();server?.close();app.exit(process.exitCode||0)})
