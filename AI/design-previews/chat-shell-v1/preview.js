const workspace = document.querySelector('#workspace')
const sidebar = document.querySelector('#conversation-sidebar')
const toggle = document.querySelector('#sidebar-toggle')
const input = document.querySelector('#message-input')
const send = document.querySelector('#send-button')
const scroll = document.querySelector('#message-scroll')
let toastTimer

function setSidebar(open) {
  workspace.classList.toggle('sidebar-hidden', !open)
  toggle.setAttribute('aria-expanded', String(open))
  toggle.setAttribute('aria-label', open ? '隐藏会话侧栏' : '显示会话侧栏')
  toggle.title = open ? '隐藏会话侧栏' : '显示会话侧栏'
  sidebar.inert = !open
}
function toast(message) {
  const el = document.querySelector('#preview-toast')
  el.textContent = message; el.classList.add('visible')
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 2300)
}
toggle.addEventListener('click', () => setSidebar(workspace.classList.contains('sidebar-hidden')))
document.querySelector('#sidebar-close').addEventListener('click', () => {setSidebar(false);toggle.focus()})
document.querySelector('#theme-toggle').addEventListener('click', () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
})
document.querySelector('#sound-toggle').addEventListener('click', event => {
  const button = event.currentTarget
  const enabled = button.getAttribute('aria-pressed') !== 'true'
  button.setAttribute('aria-pressed', String(enabled));button.classList.toggle('sound-enabled', enabled)
  button.title = enabled ? '关闭自动朗读' : '开启自动朗读'
  toast(`预览：自动朗读${enabled ? '开启' : '关闭'}，不会请求真实语音服务。`)
})
document.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => toast(`${button.dataset.preview}保留在此处，确认设计后接入现有功能。`)))
document.querySelector('#voice-preview').addEventListener('click', () => toast('这是样式预览，不会打开麦克风；正式版沿用现有按住说话功能。'))
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-copy]')
  if (!button) return
  const content = button.closest('.message-stack').querySelector('.chat-bubble').textContent
  try { await navigator.clipboard.writeText(content);toast('已复制这条预览回复。') } catch {toast('预览回复：'+content)}
})
input.addEventListener('input', () => {
  send.disabled = !input.value.trim()
  input.style.height='auto';input.style.height=Math.min(104,Math.max(42,input.scrollHeight))+'px'
})
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault();document.querySelector('#composer').requestSubmit()}
})
function addMessage(role, text) {
  const article=document.createElement('article');article.className='message '+role
  const stack=document.createElement('div');stack.className='message-stack'
  const meta=document.createElement('div');meta.className='message-meta';meta.textContent=role==='user'?'你 · 刚刚':'昔涟 · 预览回复'
  const bubble=document.createElement('div');bubble.className='chat-bubble';bubble.textContent=text
  stack.append(meta,bubble)
  const avatar=role==='user'?document.createElement('div'):document.createElement('img')
  avatar.className=role==='user'?'user-avatar':'message-avatar'
  if(role==='user'){avatar.textContent='我';article.append(stack,avatar)}else{avatar.src='/assets/ai-avatar.png';avatar.alt='';article.append(avatar,stack)}
  scroll.append(article);scroll.scrollTo({top:scroll.scrollHeight,behavior:'smooth'})
}
document.querySelector('#composer').addEventListener('submit', event => {
  event.preventDefault();const text=input.value.trim();if(!text)return
  addMessage('user',text);input.value='';input.style.height='42px';send.disabled=true
  setTimeout(()=>addMessage('assistant','这是本地样式预览，没有发送到服务器。确认设计后，会接入你现在的对话和 Fish Audio 朗读。'),350)
})
document.querySelector('#new-conversation').addEventListener('click', () => {
  scroll.replaceChildren();document.querySelector('#conversation-title').textContent='新对话'
  addMessage('assistant','今天有什么想聊的吗？慢慢说，我在听。')
  input.focus();if(innerWidth<=720)setSidebar(false)
})
document.addEventListener('keydown', event=>{if(event.key==='Escape'&&innerWidth<=720)setSidebar(false)})
setSidebar(!window.matchMedia('(max-width:720px)').matches)
window.addEventListener('load',()=>{scroll.scrollTop=scroll.scrollHeight},{once:true})
