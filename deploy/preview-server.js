// 本地预览服务器（开发/自测用）：
//   - 托管 AI/dist 里构建好的前端静态文件
//   - 把 /api/** 反代到后端 8080，并去掉 /api 前缀（和 deploy/nginx.conf、vite 代理一致）
// 生产部署用 Nginx（deploy/nginx.conf），这个脚本只是为了在本机不装 Nginx 时能直接打开页面。
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'AI', 'dist');
const BACKEND = { host: '127.0.0.1', port: 8080 };
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    const target = req.url.replace(/^\/api/, '') || '/';
    const proxyReq = http.request(
      { ...BACKEND, method: req.method, path: target, headers: { ...req.headers, host: `${BACKEND.host}:${BACKEND.port}` } },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', (error) => {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ message: `后端不可用: ${error.message}` }));
    });
    req.pipe(proxyReq);
    return;
  }

  // 静态文件；找不到就回退到 index.html（单页应用）
  let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`frontend on http://127.0.0.1:${PORT}  (root: ${ROOT})`);
});
