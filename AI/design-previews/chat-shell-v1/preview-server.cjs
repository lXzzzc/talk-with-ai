const http=require('node:http')
const fs=require('node:fs')
const path=require('node:path')
const previewRoot=__dirname
const publicRoot=path.resolve(__dirname,'../../public')
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg'}
const server=http.createServer((request,response)=>{
  let pathname
  try{pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname)}catch{response.writeHead(400).end();return}
  const assets=pathname.startsWith('/assets/')
  const root=assets?publicRoot:previewRoot
  const relative=assets?pathname.slice('/assets/'.length):pathname==='/'?'index.html':pathname.replace(/^\/preview\//,'')
  const file=path.resolve(root,relative)
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404).end();return}
  response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'})
  fs.createReadStream(file).pipe(response)
})
server.listen(0,'127.0.0.1',()=>console.log(`PREVIEW_URL=http://127.0.0.1:${server.address().port}/`))
