// Serves the real production build with isolated, in-memory chat fixtures for visual checks.
// No requests reach the user's backend or saved conversation history.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../../dist')
const conversations = [
  { sessionId: 'ui-weather', title: '今天的天气怎么样', messages: [
    { role: 'user', content: '今天的天气怎么样' },
    { role: 'assistant', content: '想看看哪座城市的天气呢？\n告诉我城市名字，我就陪你一起看看。' },
    { role: 'user', content: '杭州，也想听听你的出门建议。' },
    { role: 'assistant', content: '好呀，我们一起看看杭州的天空。\n天气结果出来后，我会把温度、降雨和出门建议整理给你。' }
  ] },
  { sessionId: 'ui-markdown', title: '整理今天的小计划', messages: [
    { role: 'user', content: '帮我整理一个计划，顺便看看代码的排版。' },
    { role: 'assistant', content: '我们慢慢来，一次做好一件小事。\n\n### 今天的小计划\n- 先完成最重要的一件事\n- 留一点时间休息\n\n```javascript\nconst greeting = "愿今天也有温柔的相遇";\nconsole.log(greeting);\nconst longLine = "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789";\n```\n\n| 时间 | 安排 |\n| --- | --- |\n| 上午 | 认真工作 |\n| 下午 | 散步休息 |\n\n不着急，我会一直陪着你。' }
  ] }
]
const json = (res, value, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(value))
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)
  if (pathname === '/api/getChatIds') return json(res, conversations.map(({ sessionId, title }) => ({ sessionId, title })))
  if (pathname.startsWith('/api/chat/')) {
    const id = pathname.split('/').pop()
    const item = conversations.find(item => item.sessionId === id)
    if (req.method === 'PATCH') {
      let body = ''; req.on('data', chunk => { body += chunk }); req.on('end', () => {
        if (!item) return json(res, {}, 404)
        item.title = JSON.parse(body).title; json(res, {})
      }); return
    }
    if (req.method === 'DELETE') {
      if (item) conversations.splice(conversations.indexOf(item), 1)
      return json(res, {})
    }
    return json(res, item?.messages || [])
  }
  if (pathname === '/api/ai/tool-intent') return json(res, { tool: 'none', requiresConfirmation: false, arguments: {} })
  if (pathname === '/api/ai/chat') {
    let body = ''; req.on('data', chunk => { body += chunk }); req.on('end', () => {
      const input = JSON.parse(body)
      let item = conversations.find(item => item.sessionId === input.conversationId)
      if (!item) { item = { sessionId: input.conversationId, title: input.prompt, messages: [] }; conversations.unshift(item) }
      const reply = '嗯，我在听。我们慢慢聊，好吗？'
      item.messages.push({ role: 'user', content: input.prompt }, { role: 'assistant', content: reply })
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.write('嗯，我在听。'); setTimeout(() => res.end('我们慢慢聊，好吗？'), 350)
    }); return
  }
  if (pathname.startsWith('/api/')) return json(res, { message: 'This isolated fixture does not provide audio or external tools.' }, 400)
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return }
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.atlas': 'text/plain' }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(res)
})
server.listen(0, '127.0.0.1', () => console.log(`CHAT_SHELL_FIXTURE=http://127.0.0.1:${server.address().port}/`))
