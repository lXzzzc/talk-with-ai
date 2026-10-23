const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../../dist')
const output = path.resolve(__dirname, '../../reports/wallpaper')
let server, win
const requests = []
async function until(expression) {
  for (let i=0;i<250;i++) {
    if (await win.webContents.executeJavaScript(expression)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Wallpaper timed out: ${expression}`)
}
app.whenReady().then(async () => {
  server = http.createServer((req,res) => {
    const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname)
    requests.push(name)
    if(name.startsWith('/api/')) { res.setHeader('Content-Type','application/json');res.end('[]');return }
    const file=path.resolve(root,'.'+(name==='/'?'/index.html':name))
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return}
    const types={'.html':'text/html','.js':'application/javascript','.json':'application/json','.atlas':'text/plain','.css':'text/css','.png':'image/png','.gif':'image/gif'}
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream')
    // Deliberately stall textures to inspect the real cold-start placeholder.
    if (/\/kv37.*\.png$/.test(name)) setTimeout(()=>fs.createReadStream(file).pipe(res),1200)
    else fs.createReadStream(file).pipe(res)
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  win=new BrowserWindow({width:1280,height:800,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`)
  await until(`document.querySelector('.wallpaper-preview')?.naturalWidth >= 2560`)
  assert.ok(await win.webContents.executeJavaScript(`(() => {
    const image=document.querySelector('.wallpaper-preview'),canvas=document.createElement('canvas');
    canvas.width=64;canvas.height=36;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,64,36);
    const pixels=ctx.getImageData(0,0,64,36).data;let visible=0,color=0;
    for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]>200)visible++;if(pixels[i]>20||pixels[i+1]>20||pixels[i+2]>20)color++}
    return visible>1500&&color>1500;
  })()`),'Startup poster must contain the wallpaper, not an empty transparent frame')
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.animated-wallpaper').dataset.state`),'loading')
  assert.equal(requests.some(name=>name.endsWith('preview.gif')),false)
  fs.mkdirSync(output,{recursive:true})
  fs.writeFileSync(path.join(output,'sharp-startup.png'),(await win.webContents.capturePage()).toPNG())
  await until(`document.querySelector('.animated-wallpaper')?.dataset.state === 'ready'`)
  await until(`Number(document.querySelector('.animated-wallpaper')?.dataset.frames) >= 30`)
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.video-pet-stage, .hero-visual').length`),0)
  const before=await win.webContents.executeJavaScript(`document.querySelector('.animated-wallpaper').dataset.frames`)
  await until(`Number(document.querySelector('.animated-wallpaper').dataset.frames) > ${Number(before)+15}`)
  assert.equal(requests.some(name=>name.startsWith('/pets/')),false)
  assert.equal(requests.some(name=>name.endsWith('music.mp3')),false)
  fs.mkdirSync(output,{recursive:true})
  fs.writeFileSync(path.join(output,'main-wallpaper.png'),(await win.webContents.capturePage()).toPNG())
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]})
  await win.webContents.executeJavaScript(`document.querySelector('[title="切换到深色主题"]')?.click()`)
  await until(`document.documentElement.dataset.theme === 'dark'`)
  await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
  fs.writeFileSync(path.join(output,'main-wallpaper-dark.png'),(await win.webContents.capturePage()).toPNG())
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:560,height:800,deviceScaleFactor:1,mobile:false})
  await until(`document.documentElement.scrollWidth <= 560`)
  await until(`Number(new DOMMatrix(getComputedStyle(document.querySelector('.sidebar')).transform).m41) < -300`)
  fs.writeFileSync(path.join(output,'main-wallpaper-mobile.png'),(await win.webContents.capturePage()).toPNG())
  win.webContents.debugger.detach()
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({sharpStartupPoster:true,noLowResolutionPreview:true,spineReady:true,animationAdvances:true,mainPetRemoved:true,noPetVideoRequests:true,noMusic:true,mobileLayout:true},null,2))
  console.log('PASS: Spine wallpaper renders and advances; main pet removed; music silent; responsive layout')
}).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{win?.destroy();server?.close();app.exit(process.exitCode||0)})

