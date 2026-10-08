<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { speak } from './edge-tts.js'

const endpoint = '/api/ai/chat'
const chatType = 'chat'
const storageKey = 'spring-ai-test-conversations'
const userIdKey = 'spring-ai-test-user-id'
const themeKey = 'spring-ai-test-theme'
const historyListEndpoint = '/api/getChatIds'

/** 与后端 chat.request.max-prompt-chars 保持一致。 */
const MAX_PROMPT_CHARS = 4000
/** 与后端 tts.max-text-chars 保持一致，超长会被切成多段合成。 */
const MAX_TTS_CHARS = 480

marked.setOptions({ breaks: true, gfm: true })

/**
 * 当前用户标识。
 *
 * 后端所有聊天记录接口都要求传 userId 并只返回该用户的数据。这里没有做登录，
 * 用的是浏览器本地生成的匿名 id —— 它只能起到「按用户分区」的作用，不是身份认证，
 * 真要对外开放还需要接入真正的登录体系。
 */
const userId = resolveUserId()

function newUserId() {
  return crypto.randomUUID?.() || `u-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function resolveUserId() {
  const stored = localStorage.getItem(userIdKey)
  if (stored) return stored

  // 兼容升级：旧版本前端从不传 userId，后端一律记为 "default"。
  // 如果本机还留着旧版本的会话列表，就继续沿用 "default"，否则历史记录会凭空消失。
  const resolved = localStorage.getItem(storageKey) ? 'default' : newUserId()
  localStorage.setItem(userIdKey, resolved)
  return resolved
}

const conversations = ref([])
const activeConversationId = ref('')
const inputText = ref('')
const messages = ref([])
const isLoading = ref(false)
const errorText = ref('')
const textareaRef = ref(null)
const editingId = ref('')
const editingTitle = ref('')
const sidebarOpen = ref(false)
const isPinned = ref(true)
const toast = ref('')
const speakingIndex = ref(null)

/** 主题：index.html 里的内联脚本已经先写好 data-theme，这里只负责读取和切换。 */
const theme = ref(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')

let abortController = null
let ttsAbortController = null
const ttsQueue = []
let ttsPlaying = false
let toastTimer = null

const ttsEnabled = ref(true)
const ttsSpokenPositions = ref({})

const activeConversation = computed(
  () => conversations.value.find((item) => item.id === activeConversationId.value) || null
)

const headerTitle = computed(() => activeConversation.value?.title || '新对话')

const headerSub = computed(() => {
  if (isLoading.value) return '正在生成回复…'
  if (errorText.value) return '请求出错，请查看对话中的提示'
  return ''
})

const canSend = computed(() => inputText.value.trim().length > 0 && !isLoading.value)



function withUser(url) {
  const target = new URL(url, window.location.origin)
  target.searchParams.set('userId', userId)
  return target.toString()
}

async function readErrorMessage(res) {
  try {
    const data = await res.json()
    return data.message || `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status} ${res.statusText}`
  }
}

function createConversationId() {
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/* ------------------------------------------------------------------ 主题 */

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme.value
  document.documentElement.style.backgroundColor = theme.value === 'light' ? '#faf7ff' : '#0b0713'
  document.documentElement.style.colorScheme = theme.value
  localStorage.setItem(themeKey, theme.value)
}

/* ------------------------------------------------------------------ 提示 */

function showToast(message) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 1800)
}

async function copyText(text, tip = '已复制') {
  const value = (text || '').trim()
  if (!value) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      // http 访问（非安全上下文）拿不到 clipboard API，退回到临时 textarea
      const helper = document.createElement('textarea')
      helper.value = value
      helper.style.position = 'fixed'
      helper.style.opacity = '0'
      document.body.appendChild(helper)
      helper.select()
      document.execCommand('copy')
      document.body.removeChild(helper)
    }
    showToast(tip)
  } catch {
    showToast('复制失败，请手动选择')
  }
}

/* -------------------------------------------------- Markdown 渲染与代码块 */

/**
 * 极轻量的「高亮外观」：只对注释、字符串、数字、关键字上色。
 * 不走 innerHTML 拼接原文，输入先整体转义，因此不存在注入风险。
 */
const TOKEN_RE =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#(?![ \t]*(?:include|define|ifn?def|endif|pragma)\b)[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|(\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|new|extends|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|interface|implements|public|private|protected|abstract|static|final|void|null|undefined|true|false|this|super|def|elif|lambda|None|True|False|package|int|double|boolean|String|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN|GROUP|ORDER|BY)\b)/g

function escapeHtml(source) {
  return source.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char])
}

function highlightCode(raw) {
  return escapeHtml(raw).replace(TOKEN_RE, (match, comment, string, number) => {
    const cls = comment ? 'tok-com' : string ? 'tok-str' : number ? 'tok-num' : 'tok-kw'
    return `<span class="${cls}">${match}</span>`
  })
}

/** 给每个 <pre> 套上「语言标签 + 复制按钮」的外壳，并做轻量高亮。 */
function decorateCodeBlocks(html) {
  if (!html.includes('<pre')) return html

  const doc = new DOMParser().parseFromString(`<div id="md-root">${html}</div>`, 'text/html')
  const root = doc.getElementById('md-root')

  root.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code')
    const langClass = code ? Array.from(code.classList).find((name) => name.startsWith('language-')) : ''
    const lang = langClass ? langClass.slice('language-'.length) : ''

    if (code) {
      code.innerHTML = highlightCode(code.textContent || '')
    }

    const block = doc.createElement('div')
    block.className = 'code-block'

    const head = doc.createElement('div')
    head.className = 'code-head'

    const label = doc.createElement('span')
    label.className = 'code-lang'
    label.textContent = lang || 'code'

    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'code-copy'
    button.textContent = '复制'

    head.append(label, button)
    pre.replaceWith(block)
    block.append(head, pre)
  })

  return root.innerHTML
}

// 流式输出时每来一个分片都会重算，缓存可以避免重复解析同一段文本
const mdCache = new Map()
const MD_CACHE_MAX = 300

function renderMarkdown(content) {
  if (!content) return ''
  const cached = mdCache.get(content)
  if (cached !== undefined) return cached

  const html = decorateCodeBlocks(DOMPurify.sanitize(marked.parse(content)))
  if (mdCache.size >= MD_CACHE_MAX) mdCache.clear()
  mdCache.set(content, html)
  return html
}

/** 代码块复制按钮通过事件委托处理，避免每次重渲染都要重新绑定。 */
function onBodyClick(event) {
  const button = event.target.closest?.('.code-copy')
  if (!button) return
  const code = button.closest('.code-block')?.querySelector('code')
  copyText(code?.textContent, '代码已复制')
}

/* ------------------------------------------------------------ 会话管理 */

function saveConversations() {
  const data = conversations.value.map((item) => ({
    id: item.id,
    title: item.title
  }))
  localStorage.setItem(storageKey, JSON.stringify(data))
}

function loadConversations() {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return []
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data
      .filter((item) => item?.id)
      .map((item) => ({
        id: item.id,
        title: item.title || item.id,
        messages: []
      }))
  } catch {
    return []
  }
}

// 会话列表以数据库为准；localStorage 只作兼容，用来保留「还没发过消息、因而尚未入库」的新对话。
async function fetchConversations() {
  try {
    const res = await fetch(withUser(historyListEndpoint))
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data
      .filter((item) => item?.sessionId)
      .map((item) => ({
        id: item.sessionId,
        title: (item.title || '').trim() || item.sessionId,
        messages: []
      }))
  } catch {
    return []
  }
}

function mergeConversations(remote, local) {
  const merged = []
  const seen = new Set()
  for (const item of [...remote, ...local]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    merged.push(item)
  }
  return merged
}

function newChat() {
  stopRequest()
  stopAllTts()
  activeConversationId.value = createConversationId()
  inputText.value = ''
  messages.value = []
  errorText.value = ''
  closeSidebar()
  nextTick(() => {
    autoGrow()
    textareaRef.value?.focus()
  })
}

async function selectConversation(conversation) {
  stopRequest()
  stopAllTts()
  closeSidebar()
  activeConversationId.value = conversation.id
  messages.value = conversation.messages
  errorText.value = ''
  isPinned.value = true

  if (conversation.messages.length > 0) {
    await scrollToBottom(true)
    return
  }

  try {
    const res = await fetch(withUser(`/api/${chatType}/${encodeURIComponent(conversation.id)}`))
    if (!res.ok) {
      throw new Error(await readErrorMessage(res))
    }
    const data = await res.json()
    conversation.messages = Array.isArray(data)
      ? data
          .filter((item) => item?.role && item?.content)
          .map((item) => ({
            role: item.role,
            content: item.content
          }))
      : []
    messages.value = conversation.messages
    await scrollToBottom(true)
  } catch (error) {
    errorText.value = error.message || '加载历史失败'
  }
}

async function removeConversation(conversation) {
  if (!window.confirm(`确定删除会话「${conversation.title}」？删除后无法恢复。`)) return

  try {
    const res = await fetch(withUser(`/api/${chatType}/${encodeURIComponent(conversation.id)}`), {
      method: 'DELETE'
    })
    // 404 说明服务端本来就没有这条记录，本地删掉即可
    if (!res.ok && res.status !== 404) {
      throw new Error(await readErrorMessage(res))
    }
    conversations.value = conversations.value.filter((item) => item.id !== conversation.id)
    saveConversations()

    if (activeConversationId.value === conversation.id) {
      if (conversations.value.length > 0) {
        await selectConversation(conversations.value[0])
      } else {
        newChat()
      }
    }
  } catch (error) {
    errorText.value = error.message || '删除会话失败'
  }
}

function startRename(conversation) {
  editingId.value = conversation.id
  editingTitle.value = conversation.title
  nextTick(() => {
    document.querySelector('.history-rename-input')?.focus()
  })
}

async function commitRename(conversation) {
  const title = editingTitle.value.trim()
  editingId.value = ''
  if (!title || title === conversation.title) return

  try {
    const res = await fetch(withUser(`/api/${chatType}/${encodeURIComponent(conversation.id)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    })
    if (!res.ok) {
      throw new Error(await readErrorMessage(res))
    }
    conversation.title = title
    saveConversations()
  } catch (error) {
    errorText.value = error.message || '重命名失败'
  }
}

function ensureConversation(prompt) {
  if (!activeConversationId.value) {
    activeConversationId.value = createConversationId()
  }

  let conversation = conversations.value.find((item) => item.id === activeConversationId.value)
  if (!conversation) {
    conversation = {
      id: activeConversationId.value,
      title: prompt.slice(0, 18) || '新对话',
      messages: []
    }
    conversations.value.unshift(conversation)
    saveConversations()
  }

  return conversation
}

/* ------------------------------------------------------------ 滚动控制 */

/**
 * 页面整体滚动（而不是把对话锁在一个内部滚动框里）：
 * 顶栏、输入框、侧栏用 position: sticky 固定在视口，正文随文档自然滚动，
 * 滚轮 = 普通的上下翻页。
 */
function onScroll() {
  const doc = document.documentElement
  isPinned.value = doc.scrollHeight - window.scrollY - window.innerHeight < 80
}

async function scrollToBottom(force = false) {
  // 用户主动往上翻时不要把他拽回底部
  if (!force && !isPinned.value) return
  await nextTick()
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' })
  isPinned.value = true
}

function jumpToBottom() {
  isPinned.value = true
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
}

/* ---------------------------------------------------------------- TTS */

function stopRequest() {
  abortController?.abort()
}

function stopAllTts() {
  ttsAbortController?.abort()
  ttsAbortController = null
  ttsQueue.length = 0
  ttsPlaying = false
  speakingIndex.value = null
  ttsSpokenPositions.value = {}
}

function processTtsQueue() {
  if (ttsPlaying || ttsQueue.length === 0) return
  ttsPlaying = true
  const item = ttsQueue.shift()
  speakingIndex.value = item.index ?? null
  speak(item.text, { signal: item.signal })
    .catch(() => {})
    .finally(() => {
      ttsPlaying = false
      if (ttsQueue.length === 0) speakingIndex.value = null
      processTtsQueue()
    })
}

/** 把一段文本切成不超过 max 字的片段（优先在句末断开）。 */
function chunkText(text, max = MAX_TTS_CHARS) {
  const segments = []
  const re = /[^。！？!?.\n]+[。！？!?.\n]?/g
  let match
  while ((match = re.exec(text)) !== null) segments.push(match[0])

  const chunks = []
  let buffer = ''
  for (const segment of segments) {
    if (segment.length > max) {
      if (buffer) {
        chunks.push(buffer)
        buffer = ''
      }
      for (let i = 0; i < segment.length; i += max) chunks.push(segment.slice(i, i + max))
      continue
    }
    if (buffer.length + segment.length > max) {
      chunks.push(buffer)
      buffer = segment
    } else {
      buffer += segment
    }
  }
  if (buffer) chunks.push(buffer)
  return chunks.filter((item) => item.trim())
}

function enqueueTts(text, index) {
  if (!ttsEnabled.value) return
  const chunks = chunkText(text)
  if (chunks.length === 0) return

  if (!ttsAbortController || ttsAbortController.signal.aborted) {
    ttsAbortController = new AbortController()
  }
  for (const chunk of chunks) {
    ttsQueue.push({ text: chunk.trim(), signal: ttsAbortController.signal, index })
  }
  processTtsQueue()
}

const SENTENCE_RE = /[^。！？!?.\n]+[。！？!?.\n]+/g

/** 边流边读：只把「已经写完整的句子」丢进队列，避免读半截话。 */
function speakNewSentences(messageIndex, content) {
  if (!ttsEnabled.value) return
  const lastPos = ttsSpokenPositions.value[messageIndex] || 0
  if (lastPos >= content.length) return

  const pending = content.slice(lastPos)
  const sentences = []
  let match
  let end = 0
  while ((match = SENTENCE_RE.exec(pending)) !== null) {
    sentences.push(match[0])
    end = match.index + match[0].length
  }
  SENTENCE_RE.lastIndex = 0
  if (sentences.length === 0) return

  ttsSpokenPositions.value = { ...ttsSpokenPositions.value, [messageIndex]: lastPos + end }
  for (const sentence of sentences) enqueueTts(sentence, messageIndex)
}

/** 流结束时把没有句末标点的尾巴补读掉。 */
function flushTtsTail(messageIndex, content) {
  if (!ttsEnabled.value) return
  const lastPos = ttsSpokenPositions.value[messageIndex] || 0
  if (lastPos >= content.length) return
  ttsSpokenPositions.value = { ...ttsSpokenPositions.value, [messageIndex]: content.length }
  enqueueTts(content.slice(lastPos), messageIndex)
}

/** 手动朗读整条回复。 */
function speakMessage(index, message) {
  const text = (message.content || '').trim()
  if (!text) return
  stopAllTts()
  ttsAbortController = new AbortController()
  ttsSpokenPositions.value = { ...ttsSpokenPositions.value, [index]: text.length }
  enqueueTts(text, index)
}

function toggleTts() {
  ttsEnabled.value = !ttsEnabled.value
  if (!ttsEnabled.value) {
    stopAllTts()
  } else {
    showToast('已开启自动朗读')
  }
}

/* ------------------------------------------------------------ 发送流程 */

async function runStream(conversation, prompt, { appendUser }) {
  isLoading.value = true
  errorText.value = ''
  abortController = new AbortController()
  stopAllTts()

  if (appendUser) {
    conversation.messages.push({ role: 'user', content: prompt })
  }
  const assistantMessage = { role: 'assistant', content: '' }
  conversation.messages.push(assistantMessage)
  messages.value = conversation.messages
  isPinned.value = true
  await scrollToBottom(true)

  const messageIndex = conversation.messages.length - 1

  try {
    // POST + JSON：prompt 不再出现在 URL 里
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: abortController.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/html;charset=utf-8'
      },
      body: JSON.stringify({
        userId,
        conversationId: conversation.id,
        prompt
      })
    })

    if (!res.ok) {
      throw new Error(await readErrorMessage(res))
    }

    if (!res.body) {
      assistantMessage.content = await res.text()
      conversation.messages[messageIndex] = { ...assistantMessage }
      messages.value = conversation.messages
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      assistantMessage.content += decoder.decode(value, { stream: true })
      conversation.messages[messageIndex] = { ...assistantMessage }
      messages.value = conversation.messages
      speakNewSentences(messageIndex, assistantMessage.content)
      await scrollToBottom()
    }

    assistantMessage.content += decoder.decode()
    conversation.messages[messageIndex] = { ...assistantMessage }
    messages.value = conversation.messages
    flushTtsTail(messageIndex, assistantMessage.content)
  } catch (error) {
    if (error.name === 'AbortError') {
      // 用户点了「停止」：保留已经生成的部分，不当作错误
      return
    }
    errorText.value = error.message || '请求失败'
    assistantMessage.content = '请求失败，请确认后端服务已启动。'
    conversation.messages[messageIndex] = { ...assistantMessage }
    messages.value = conversation.messages
  } finally {
    isLoading.value = false
    abortController = null
    await scrollToBottom()
  }
}

async function sendPrompt() {
  const prompt = inputText.value.trim()
  if (!prompt || isLoading.value) return

  const conversation = ensureConversation(prompt)
  messages.value = conversation.messages
  inputText.value = ''
  await nextTick()
  autoGrow()

  await runStream(conversation, prompt, { appendUser: true })
}

/**
 * 重新生成某条回复。
 *
 * 注意：后端没有「删除单条消息」的接口，重新生成时它会按会话再存一条 user + assistant，
 * 因此刷新页面向数据库回读历史时会看到两条回复。
 */
async function regenerate(index) {
  if (isLoading.value) return
  const conversation = activeConversation.value
  if (!conversation) return

  const list = conversation.messages
  let userIndex = -1
  for (let i = index - 1; i >= 0; i--) {
    if (list[i].role === 'user') {
      userIndex = i
      break
    }
  }
  if (userIndex < 0) return

  const prompt = list[userIndex].content
  list.splice(userIndex + 1)
  messages.value = list

  await runStream(conversation, prompt, { appendUser: false })
}

function useSuggestion(suggestion) {
  inputText.value = suggestion.text
  nextTick(() => {
    autoGrow()
    textareaRef.value?.focus()
  })
}

function handleEnter(event) {
  if (!event.shiftKey) {
    event.preventDefault()
    sendPrompt()
  }
}

/* ------------------------------------------------------------ 其它交互 */

function autoGrow() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}

function openSidebar() {
  sidebarOpen.value = true
}

function closeSidebar() {
  sidebarOpen.value = false
}

function onKeydown(event) {
  if (event.key === 'Escape') closeSidebar()
}

watch(inputText, () => nextTick(autoGrow))

onMounted(async () => {
  document.documentElement.dataset.theme = theme.value
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('scroll', onScroll, { passive: true })

  const local = loadConversations()
  const remote = await fetchConversations()
  conversations.value = mergeConversations(remote, local)
  if (conversations.value.length > 0) {
    await selectConversation(conversations.value[0])
  } else {
    newChat()
  }
  autoGrow()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', onScroll)
  clearTimeout(toastTimer)
  stopRequest()
  stopAllTts()
})
</script>

<template>
  <div class="app">
    <div class="backdrop" aria-hidden="true"></div>

    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <div class="brand">
        <div class="brand-logo">
          <img src="/ai-avatar.png" alt="" />
        </div>
        <div>
          <div class="brand-name">昔涟</div>
          <div class="brand-sub">翁法洛斯第十三位黄金裔</div>
        </div>
      </div>

      <button class="new-chat" type="button" @click="newChat">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        新建对话
      </button>

      <div class="history-head">
        <span class="history-title">历史记录</span>
        <span v-if="conversations.length" class="history-count">{{ conversations.length }}</span>
      </div>

      <div class="history-list">
        <div
          v-for="conversation in conversations"
          :key="conversation.id"
          class="history-item"
          :class="{ active: conversation.id === activeConversationId }"
          @click="selectConversation(conversation)"
        >
          <input
            v-if="editingId === conversation.id"
            v-model="editingTitle"
            class="history-rename-input"
            type="text"
            maxlength="200"
            @click.stop
            @keydown.enter.prevent="commitRename(conversation)"
            @keydown.esc.prevent="editingId = ''"
            @blur="commitRename(conversation)"
          />
          <template v-else>
            <span class="history-name">{{ conversation.title }}</span>
            <span class="history-actions">
              <button class="icon-mini" type="button" title="重命名" @click.stop="startRename(conversation)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
              <button class="icon-mini danger" type="button" title="删除" @click.stop="removeConversation(conversation)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                </svg>
              </button>
            </span>
          </template>
        </div>
        <div v-if="conversations.length === 0" class="empty-history">还没有历史对话</div>
      </div>

      <div class="sidebar-foot">
        <span class="dot"></span>
        <span>本机匿名身份 · 数据按浏览器分区</span>
      </div>
    </aside>

    <div v-if="sidebarOpen" class="overlay" @click="closeSidebar"></div>

    <main class="chat-panel">
      <header class="chat-header">
        <button class="icon-btn menu-btn" type="button" title="会话列表" @click="openSidebar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <div class="header-info">
          <h1 class="header-title">{{ headerTitle }}</h1>
          <p class="header-sub">{{ headerSub }}</p>
        </div>

        <div class="header-actions">
          <button
            class="icon-btn"
            type="button"
            :title="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
            @click="toggleTheme"
          >
            <svg v-if="theme === 'dark'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 2v2.3M12 19.7V22M2 12h2.3M19.7 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6" />
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
            </svg>
          </button>

          <button
            class="icon-btn"
            :class="{ on: ttsEnabled }"
            type="button"
            :title="ttsEnabled ? '关闭自动朗读' : '开启自动朗读'"
            @click="toggleTts"
          >
            <svg v-if="ttsEnabled" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
              <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" />
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
              <path d="m16 9.5 5 5M21 9.5l-5 5" />
            </svg>
          </button>
        </div>
      </header>

      <section class="chat-body" @click="onBodyClick">
        <div v-if="messages.length === 0" class="hero">
          <div class="hero-badge">
            <img src="/ai-avatar.png" alt="" />
          </div>
          <h2 class="hero-title">要和昔涟说些什么吗？</h2>
          <p class="hero-sub"> </p>
          <div class="suggestions">
            <button
              v-for="suggestion in suggestions"
              :key="suggestion.text"
              class="suggestion"
              type="button"
              @click="useSuggestion(suggestion)"
            >
              <span class="suggestion-title">{{ suggestion.icon }} {{ suggestion.title }}</span>
              <span class="suggestion-text">{{ suggestion.text }}</span>
            </button>
          </div>
        </div>

        <div v-else class="thread">
          <article
            v-for="(message, index) in messages"
            :key="index"
            class="msg"
            :class="message.role"
          >
            <div class="avatar">
              <img v-if="message.role === 'assistant'" src="/ai-avatar.png" alt="AI" />
              <template v-else>我</template>
            </div>

            <div class="msg-main">
              <div class="bubble">
                <span
                  v-if="message.role === 'assistant' && !message.content"
                  class="typing"
                >
                  <span class="typing-dots"><i></i><i></i><i></i></span>
                  {{ isLoading ? '正在生成…' : '没有返回内容' }}
                </span>
                <template v-else-if="message.role === 'assistant'">
                  <div
                    class="markdown"
                    :class="{ streaming: isLoading && index === messages.length - 1 }"
                    v-html="renderMarkdown(message.content)"
                  ></div>
                </template>
                <template v-else>{{ message.content }}</template>
              </div>

              <div class="msg-actions">
                <button class="action-btn" type="button" @click="copyText(message.content, '已复制')">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="11" height="11" rx="2.4" />
                    <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
                  </svg>
                  复制
                </button>

                <template v-if="message.role === 'assistant'">
                  <button
                    class="action-btn"
                    :class="{ active: speakingIndex === index }"
                    type="button"
                    @click="speakMessage(index, message)"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
                      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                    </svg>
                    {{ speakingIndex === index ? '朗读中' : '朗读' }}
                  </button>

                  <button
                    class="action-btn"
                    type="button"
                    :disabled="isLoading"
                    title="重新生成（服务端会再记录一条回复）"
                    @click="regenerate(index)"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
                      <path d="M20 4v7h-7" />
                    </svg>
                    重新生成
                  </button>
                </template>
              </div>
            </div>
          </article>
        </div>

        <div v-if="errorText" class="thread" style="margin-top: 14px">
          <div class="error">{{ errorText }}</div>
        </div>
      </section>

      <button
        v-if="!isPinned && messages.length > 0"
        class="to-bottom"
        type="button"
        title="回到底部"
        @click="jumpToBottom"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
      </button>

      <div class="composer-wrap">
        <form class="composer" @submit.prevent="sendPrompt">
          <div class="composer-field">
            <textarea
              ref="textareaRef"
              v-model="inputText"
              rows="1"
              :maxlength="MAX_PROMPT_CHARS"
              placeholder="输入消息，Enter 发送，Shift + Enter 换行"
              @keydown.enter="handleEnter"
            ></textarea>
            <div class="composer-meta">
              <span>Enter 发送 · Shift + Enter 换行</span>
              <span
                v-if="inputText.length > 2500"
                class="char-count"
                :class="{ warn: inputText.length > MAX_PROMPT_CHARS - 300 }"
              >
                {{ inputText.length }} / {{ MAX_PROMPT_CHARS }}
              </span>
            </div>
          </div>

          <button v-if="isLoading" class="send stop" type="button" title="停止生成" @click="stopRequest">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2.5" />
            </svg>
          </button>
          <button v-else class="send" type="submit" :disabled="!canSend" title="发送">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4.5 12h13M12 6.5l5.5 5.5-5.5 5.5" />
            </svg>
          </button>
        </form>
      </div>
    </main>

    <div class="toast" :class="{ show: !!toast }" aria-live="polite">{{ toast }}</div>
  </div>
</template>
