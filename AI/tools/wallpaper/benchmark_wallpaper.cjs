const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), http = require('node:http')
const root=path.resolve(__dirname,'../../dist')
let server,win
app.whenReady().then(async()=>{
 server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
  if(name.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end('[]');return}
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name))
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return}
  const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.atlas':'text/plain'}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res)
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 win=new BrowserWindow({width:1500,height:900,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
 await win.loadURL(`http://127.0.0.1:${server.address().port}/`)
 const result=await win.webContents.executeJavaScript(`(async()=>{
  for(let i=0;i<200;i++){
   if(document.querySelector('.animated-wallpaper')?.dataset.state==='ready')break;
   await new Promise(r=>setTimeout(r,100));
  }
  const host=document.querySelector('.animated-wallpaper');
  if(host?.dataset.state!=='ready')throw Error('wallpaper not ready');
  await new Promise(r=>setTimeout(r,1500));
  const before=Number(host.dataset.frames||0),start=performance.now();
  await new Promise(r=>setTimeout(r,6000));
  const elapsed=performance.now()-start, frames=Number(host.dataset.frames||0)-before;
  const canvas=host.querySelector('canvas');
  return {fps:frames*1000/elapsed,frames,elapsed,canvas:[canvas.width,canvas.height],dpr:devicePixelRatio};
 })()`)
 result.gpu=app.getGPUFeatureStatus()
 result.mode=app.commandLine.hasSwitch('disable-gpu')?'software':'accelerated'
 const output=path.resolve(__dirname,'../../reports/wallpaper')
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'fps-'+result.mode+'.json'),JSON.stringify(result,null,2))
 console.log(JSON.stringify(result))
}).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{win?.destroy();server?.close();app.exit(process.exitCode||0)})

