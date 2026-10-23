// Export an actual 2560x1440 first frame, not the Workshop thumbnail.
const {app,BrowserWindow}=require('electron')
const fs=require('node:fs'),path=require('node:path'),http=require('node:http')
const assets=path.resolve(__dirname,'../../public/wallpapers/xilian-workshop-3593357539')
app.commandLine.appendSwitch('force-device-scale-factor','1')
let server,win
app.whenReady().then(async()=>{
 server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
  if(name==='/'){res.setHeader('Content-Type','text/html');res.end('<html><head><link rel="stylesheet" href="/spine-player.css"></head><body style="margin:0"><div id="player" style="width:2560px;height:1440px"></div><script src="/spine-player.js"></script></body></html>');return}
  const file=path.resolve(assets,'.'+name)
  if(!file.startsWith(assets+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');fs.createReadStream(file).pipe(res)
 })
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 win=new BrowserWindow({width:2560,height:1440,useContentSize:true,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
 await win.loadURL('http://127.0.0.1:'+server.address().port)
 const data=await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('poster export timed out')),20000);
  let frames=0;
  new spine.SpinePlayer('player',{
   jsonUrl:'/3.7kv.json',atlasUrl:'/3.7kv.atlas',animation:'animation',showControls:false,showLoading:false,
   alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true,
   viewport:{x:-900,y:-200,width:1600,height:600,debugRender:false},
   error:(_,error)=>{clearTimeout(timer);reject(Error(error))},
   draw:player=>{
    if(++frames<3)return;
    const gl=player.context.gl, pixels=new Uint8Array(player.canvas.width*player.canvas.height*4);
    gl.readPixels(0,0,player.canvas.width,player.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let visible=0,colored=0;
    for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]>200)visible++;if(pixels[i]>20||pixels[i+1]>20||pixels[i+2]>20)colored++}
    if(visible<100000||colored<100000)return;
    clearTimeout(timer);player.pause();resolve(player.canvas.toDataURL('image/png'));
   }
  });
 })`)
 fs.writeFileSync(path.join(assets,'poster.png'),Buffer.from(data.split(',')[1],'base64'))
 console.log('Exported 2560x1440 wallpaper poster')
}).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{win?.destroy();server?.close();app.exit(process.exitCode||0)})

