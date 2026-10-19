<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { apiUrl } from './api.js'
import { openVoiceCallWindow, VOICE_CHANNEL, VOICE_CONTEXT_KEY } from './voiceCallWindow.js'
import { httpFetch } from './http.js'
import { withUserId } from './httpRouting.js'
import ConfirmDeleteDialog from './ConfirmDeleteDialog.vue'
import {
  chooseLocalApplicationFile,
  findLocalApplications,
  openLocalApplication,
  parseOpenApplicationCommand
} from './localCommands.js'
import { isDesktopRuntime } from './runtime.js'
import { analyzeWindowCapture, captureCurrentWindow } from './screenVision.js'
import { playBlob, speak, synthesize } from './tts.js'
import {
  isVoiceInputSupported,
  startVoiceRecording,
  transcribeAudio
} from './voiceInput.js'

const endpoint = apiUrl('/api/ai/chat')
const chatType = 'chat'
const storageKey = 'spring-ai-test-conversations'
const userIdKey = 'spring-ai-test-user-id'
const themeKey = 'spring-ai-test-theme'
const weatherCityKey = 'spring-ai-test-weather-city'
const weatherLocationKey = 'spring-ai-test-weather-location'
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
const desktopRuntime = isDesktopRuntime()

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
const responseStage = ref('idle')
const errorText = ref('')
const textareaRef = ref(null)
const editingId = ref('')
const editingTitle = ref('')
const sidebarOpen = ref(false)
const isPinned = ref(true)
const toast = ref('')
const speakingIndex = ref(null)
const weatherOpen = ref(false)
const weatherCity = ref(localStorage.getItem(weatherCityKey) || '')
const weatherLocation = ref(localStorage.getItem(weatherLocationKey) || weatherCity.value)
const weatherData = ref(null)
const weatherLoading = ref(false)
const weatherError = ref('')
const pendingAppLaunch = ref(null)
const openingApp = ref(false)
const recentApplication = ref(null)
const screenshotPreview = ref(null)
const screenshotQuestion = ref('')
const screenshotBusy = ref(false)
const voiceState = ref('idle')
const voiceCallActive = ref(false)
const voiceCallConversationId = ref('')
const pendingDeleteConversation = ref(null)
const deletingConversation = ref(false)
const deleteError = ref('')
const historyError = ref('')
const historyLoading = ref(false)
let historySelection = 0
let voiceChannel = null
let voiceHeartbeatTimer = null
let lastVoiceHeartbeat = 0

const suggestions = [
  { icon: '✨', title: '随便聊聊', text: '今天有什么值得开心的小事？' },
  { icon: '📚', title: '帮我学习', text: '请用简单的方式教我一个有趣的新知识。' },
  { icon: '💡', title: '一起想想', text: '帮我整理一下今天最重要的三件事。' },
  { icon: '🌤️', title: '天气建议', text: '打开右上角的天气按钮，看看今天适合做什么。' }
]

/** 主题：index.html 里的内联脚本已经先写好 data-theme，这里只负责读取和切换。 */
const theme = ref(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')

let abortController = null
let ttsAbortController = null
const ttsQueue = []
let ttsPlaying = false
let toastTimer = null
let voiceRecorder = null
let voicePressActive = false
let voiceMaxTimer = null

const ttsEnabled = ref(true)
const ttsSpokenPositions = ref({})

const activeConversation = computed(
  () => conversations.value.find((item) => item.id === activeConversationId.value) || null
)

const selectedPendingApplication = computed(() => {
  const pending = pendingAppLaunch.value
  if (!pending) return null
  return (
    pending.applications.find((application) => application.id === pending.selectedApplicationId) ||
    pending.applications[0] ||
    null
  )
})

const headerTitle = computed(() => activeConversation.value?.title || '新对话')

const headerSub = computed(() => {
  if (voiceState.value === 'requesting') return '正在请求麦克风权限…'
  if (voiceState.value === 'recording') return '正在聆听，松开后发送'
  if (voiceState.value === 'transcribing') return '正在识别你的话…'
  if (responseStage.value === 'analyzing') return '正在查看你确认的窗口截图…'
  if (isLoading.value) return ''
  if (errorText.value) return '请求出错，请查看对话中的提示'
  return ''
})

const canSend = computed(
  () =>
    inputText.value.trim().length > 0 &&
    !isLoading.value &&
    !openingApp.value &&
    !screenshotBusy.value &&
    !voiceCallActive.value &&
    voiceState.value === 'idle'
)

function publishVoiceContext() {
  if (!voiceCallConversationId.value) return
  localStorage.setItem(VOICE_CONTEXT_KEY, JSON.stringify({
    userId, conversationId: voiceCallConversationId.value,
    weatherLocation: weatherLocation.value.trim() || null,
    clientContext: recentApplication.value ? { recentApplication: recentApplication.value.label } : null
  }))
  voiceChannel?.postMessage({ type: 'voice.context', userId })
}

async function startRealtimeCall() {
  if (isLoading.value || screenshotBusy.value || openingApp.value || voiceState.value !== 'idle') return
  stopAllTts()
  const conversation = conversations.value.find(item => item.id === voiceCallConversationId.value)
    || ensureConversation('与昔涟语音通话')
  voiceCallConversationId.value = conversation.id
  publishVoiceContext()
  try {
    await openVoiceCallWindow(JSON.parse(localStorage.getItem(VOICE_CONTEXT_KEY)))
  } catch (error) {
    showToast(error.message || '无法打开通话窗口')
  }
}

async function onVoiceWindowMessage({ data }) {
  if (!data || data.userId !== userId) return
  if (data.type === 'voice.status') {
    lastVoiceHeartbeat = Date.now()
    voiceCallActive.value = Boolean(data.active)
    voiceCallConversationId.value = data.windowOpen ? data.conversationId : ''
  }
  if (data.type !== 'voice.history' || isLoading.value) return
  const conversation = conversations.value.find(item => item.id === data.conversationId)
  if (!conversation) return
  try {
    const response = await httpFetch(withUser(`/api/chat/${encodeURIComponent(conversation.id)}`))
    if (!response.ok) return
    const rows = await response.json()
    conversation.messages = rows.map(row => ({ role: row.role, content: row.content }))
    if (activeConversationId.value === conversation.id) messages.value = conversation.messages
  } catch { /* 通话结束后仍可通过会话切换重新加载。 */ }
}

const voiceButtonTitle = computed(() => {
  if (voiceState.value === 'recording') return '松开并发送'
  if (voiceState.value === 'requesting') return '正在请求麦克风权限'
  if (voiceState.value === 'transcribing') return '正在识别语音'
  return '按住说话'
})



function withUser(url) {
  return withUserId(apiUrl(url), userId, window.location.origin)
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
  historyLoading.value = true
  historyError.value = ''
  try {
    const res = await httpFetch(withUser(historyListEndpoint))
    if (!res.ok) throw new Error(await readErrorMessage(res))
    const data = await res.json()
    if (!Array.isArray(data)) throw new Error('服务器返回的会话列表格式无效')
    return data
      .filter((item) => item?.sessionId)
      .map((item) => ({
        id: item.sessionId,
        title: (item.title || '').trim() || item.sessionId,
        messages: []
      }))
  } catch (error) {
    historyError.value = `会话列表加载失败：${error?.message || String(error)}`
    return []
  } finally {
    historyLoading.value = false
  }
}

async function retryHistory() {
  if (historyLoading.value) return
  const remote = await fetchConversations()
  if (historyError.value) return
  conversations.value = mergeConversations(remote, conversations.value)
  const conversation = conversations.value.find(item => item.id === activeConversationId.value)
    || conversations.value[0]
  if (conversation) await selectConversation(conversation)
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
  historySelection++
  stopRequest()
  stopAllTts()
  pendingAppLaunch.value = null
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
  const selection = ++historySelection
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
    const res = await httpFetch(withUser(`/api/${chatType}/${encodeURIComponent(conversation.id)}`))
    if (selection !== historySelection) return
    // 本地保留的未发送会话还没有服务端记录，不应当作为网络故障显示。
    if (res.status === 404) {
      conversation.messages = []
      messages.value = []
      return
    }
    if (!res.ok) {
      throw new Error(await readErrorMessage(res))
    }
    const data = await res.json()
    if (selection !== historySelection) return
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
    if (selection === historySelection) errorText.value = `加载历史失败：${error?.message || String(error)}`
  }
}

function requestDeleteConversation(conversation) {
  if (voiceCallActive.value && conversation.id === voiceCallConversationId.value) {
    showToast('请先结束这个对话的语音通话')
    return
  }
  deleteError.value = ''
  pendingDeleteConversation.value = conversation
}

async function removeConversation() {
  const conversation = pendingDeleteConversation.value
  if (!conversation || deletingConversation.value) return
  deletingConversation.value = true
  deleteError.value = ''

  try {
    const res = await httpFetch(withUser(`/api/${chatType}/${encodeURIComponent(conversation.id)}`), {
      method: 'DELETE'
    })
    // 404 说明服务端本来就没有这条记录，本地删掉即可
    if (!res.ok && res.status !== 404) {
      throw new Error(await readErrorMessage(res))
    }
    conversations.value = conversations.value.filter((item) => item.id !== conversation.id)
    saveConversations()
    pendingDeleteConversation.value = null
    showToast('对话已删除')

    if (activeConversationId.value === conversation.id) {
      if (conversations.value.length > 0) {
        await selectConversation(conversations.value[0])
      } else {
        newChat()
      }
    }
  } catch (error) {
    deleteError.value = `删除会话失败：${error?.message || String(error)}`
  } finally {
    deletingConversation.value = false
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
    const res = await httpFetch(withUser(`/api/${chatType}/${encodeURIComponent(conversation.id)}`), {
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
  ttsAbortController?.abort()
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
  const playback = item.blob
    ? playBlob(item.blob, { signal: item.signal })
    : speak(item.text, { signal: item.signal })
  playback
    .catch((error) => {
      // IndexTTS 没启动、预设缺失等都会走到这里；提示一次并清空剩余队列，避免连续重试。
      if (error?.name === 'AbortError') return
      ttsQueue.length = 0
      showToast(error?.message || '语音合成失败，请检查本地 IndexTTS 是否已启动')
    })
    .finally(() => {
      ttsPlaying = false
      if (ttsQueue.length === 0) speakingIndex.value = null
      processTtsQueue()
    })
}

async function synthesizeMessageAudio(text, signal) {
  if (!ttsEnabled.value) return []
  const blobs = []
  for (const chunk of chunkText(text)) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    blobs.push(await synthesize(chunk.trim(), { signal }))
  }
  return blobs
}

function enqueueAudioBlobs(blobs, index, signal) {
  for (const blob of blobs) {
    if (blob?.size) ttsQueue.push({ blob, signal, index })
  }
  processTtsQueue()
}

/** 把一段文本切成不超过 max 字的片段（优先在句末断开）。 */
function chunkText(text, max = MAX_TTS_CHARS) {
  text = removeParentheticalText(text)
  if (!text.trim()) return []
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

/** 去掉所有完整配对的括号及其中内容；支持常见中英文括号和嵌套。 */
function removeParentheticalText(text) {
  const source = String(text ?? '')
  let result = ''
  let pending = ''
  const closingStack = []
  const bracketPairs = {
    '(': ')',
    '（': '）',
    '[': ']',
    '［': '］',
    '【': '】',
    '{': '}',
    '｛': '｝',
    '〔': '〕'
  }

  for (const char of source) {
    if (bracketPairs[char]) {
      pending += char
      closingStack.push(bracketPairs[char])
      continue
    }

    if (closingStack.length > 0) {
      pending += char
      if (char === closingStack[closingStack.length - 1]) {
        closingStack.pop()
        if (closingStack.length === 0) {
          pending = ''
        }
      }
      continue
    }

    result += char
  }
  // 未闭合的括号原样补回，避免输入有误时把后续正文全部吞掉。
  return result + pending
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
  if (voiceCallActive.value) return
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

async function runStream(conversation, prompt, { appendUser, localAction = null }) {
  isLoading.value = true
  responseStage.value = 'generating'
  errorText.value = ''
  abortController = new AbortController()
  stopAllTts()
  if (ttsEnabled.value) ttsAbortController = new AbortController()

  if (appendUser) {
    conversation.messages.push({ role: 'user', content: prompt })
  }
  const assistantMessage = { role: 'assistant', content: '' }
  conversation.messages.push(assistantMessage)
  messages.value = conversation.messages
  isPinned.value = true
  await scrollToBottom(true)

  const messageIndex = conversation.messages.length - 1
  let generatedContent = ''

  try {
    // POST + JSON：prompt 不再出现在 URL 里
    const res = await httpFetch(endpoint, {
      method: 'POST',
      signal: abortController.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/html;charset=utf-8'
      },
      body: JSON.stringify({
        userId,
        conversationId: conversation.id,
        prompt,
        weatherLocation: weatherLocation.value.trim() || null,
        clientContext: recentApplication.value
          ? {
              recentApplication: recentApplication.value.label,
              localAction
            }
          : null
      })
    })

    if (!res.ok) {
      throw new Error(await readErrorMessage(res))
    }

    if (!res.body) {
      generatedContent = await res.text()
    } else {
      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        // 回复先在内存中缓存，不在语音合成完成前交给界面渲染。
        generatedContent += decoder.decode(value, { stream: true })
      }
      generatedContent += decoder.decode()
    }

    const finalText = generatedContent.trim()
    let audioBlobs = []

    if (ttsEnabled.value && finalText) {
      responseStage.value = 'synthesizing'
      const signal = ttsAbortController?.signal || new AbortController().signal
      try {
        // 所有音频片段合成成功后才显示完整文字回复。
        audioBlobs = await synthesizeMessageAudio(finalText, signal)
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        // 合成服务故障时仍允许用户看到回复，避免消息永久卡在加载态。
        showToast(error?.message || '语音合成失败，已显示文字回复')
      }
    }

    assistantMessage.content = generatedContent
    conversation.messages[messageIndex] = { ...assistantMessage }
    messages.value = conversation.messages
    await scrollToBottom()

    if (audioBlobs.length > 0) {
      const signal = ttsAbortController?.signal || new AbortController().signal
      enqueueAudioBlobs(audioBlobs, messageIndex, signal)
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      // 用户主动停止时保留已经生成的部分，不再继续等待语音。
      assistantMessage.content = generatedContent
      conversation.messages[messageIndex] = { ...assistantMessage }
      messages.value = conversation.messages
      return
    }
    const detail = error.message || '未知网络错误'
    errorText.value = detail
    assistantMessage.content = `请求失败：${detail}`
    conversation.messages[messageIndex] = { ...assistantMessage }
    messages.value = conversation.messages
  } finally {
    isLoading.value = false
    responseStage.value = 'idle'
    abortController = null
    await scrollToBottom()
  }
}

async function appendLocalAssistantMessage(conversation, content) {
  let audioBlobs = []
  let signal = null

  if (ttsEnabled.value && content.trim()) {
    stopAllTts()
    ttsAbortController = new AbortController()
    signal = ttsAbortController.signal
    try {
      // 与普通回复保持一致：语音准备好之后才显示文字。
      audioBlobs = await synthesizeMessageAudio(content, signal)
    } catch (error) {
      if (error?.name !== 'AbortError') showToast(error?.message || '语音合成失败，已显示文字回复')
    }
  }

  conversation.messages.push({ role: 'assistant', content })
  messages.value = conversation.messages
  const messageIndex = conversation.messages.length - 1
  await scrollToBottom(true)
  if (audioBlobs.length > 0 && signal && !signal.aborted) {
    enqueueAudioBlobs(audioBlobs, messageIndex, signal)
  }
}

async function handleLocalApplicationCommand(prompt, command) {
  const conversation = ensureConversation(prompt)
  conversation.messages.push({ role: 'user', content: prompt })
  messages.value = conversation.messages
  await scrollToBottom(true)

  if (!isDesktopRuntime()) {
    openingApp.value = true
    try {
      await appendLocalAssistantMessage(conversation, '打开本地软件仅支持昔涟 AI 桌面客户端。')
    } finally {
      openingApp.value = false
    }
    return
  }

  openingApp.value = true
  try {
    const applications = await findLocalApplications(command.target)
    pendingAppLaunch.value = {
      target: command.target,
      prompt,
      applications,
      selectedApplicationId: applications[0]?.id || '',
      conversation
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await appendLocalAssistantMessage(conversation, `搜索本机软件失败：${detail}`)
  } finally {
    openingApp.value = false
  }
}

async function confirmApplicationLaunch() {
  const pending = pendingAppLaunch.value
  const application = selectedPendingApplication.value
  if (!pending || !application || openingApp.value) return
  openingApp.value = true

  try {
    await openLocalApplication(application.id)
    recentApplication.value = application
    pendingAppLaunch.value = null
    openingApp.value = false
    await runStream(pending.conversation, pending.prompt, {
      appendUser: false,
      localAction: 'application_opened'
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await appendLocalAssistantMessage(
      pending.conversation,
      `打开${application.label}失败：${detail}`
    )
  } finally {
    pendingAppLaunch.value = null
    openingApp.value = false
  }
}

async function cancelApplicationLaunch() {
  const pending = pendingAppLaunch.value
  if (!pending || openingApp.value) return
  const applicationLabel = selectedPendingApplication.value?.label
  pendingAppLaunch.value = null
  openingApp.value = true
  try {
    await appendLocalAssistantMessage(
      pending.conversation,
      `已取消打开${applicationLabel || pending.target || '该软件'}。`
    )
  } finally {
    openingApp.value = false
  }
}

async function chooseApplicationFile() {
  const pending = pendingAppLaunch.value
  if (!pending || openingApp.value) return
  openingApp.value = true
  try {
    const application = await chooseLocalApplicationFile(pending.target)
    if (!application) return
    pending.applications = [application]
    pending.selectedApplicationId = application.id
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await appendLocalAssistantMessage(pending.conversation, `添加本机软件失败：${detail}`)
    pendingAppLaunch.value = null
  } finally {
    openingApp.value = false
  }
}

/* ------------------------------------------------------ 截图理解与语音输入 */

const DEFAULT_SCREENSHOT_QUESTION = '请概括当前窗口的内容，并指出值得我注意的信息。'

async function openScreenshotPreview() {
  if (!desktopRuntime || isLoading.value || openingApp.value || screenshotBusy.value) return

  screenshotBusy.value = true
  stopAllTts()
  try {
    const capture = await captureCurrentWindow()
    screenshotPreview.value = capture
    screenshotQuestion.value = DEFAULT_SCREENSHOT_QUESTION
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    showToast(detail || '当前窗口截图失败')
  } finally {
    screenshotBusy.value = false
  }
}

function cancelScreenshotPreview() {
  if (screenshotBusy.value) return
  screenshotPreview.value = null
  screenshotQuestion.value = ''
}

async function analyzeScreenshot() {
  const capture = screenshotPreview.value
  if (!capture || isLoading.value || screenshotBusy.value) return

  const question = screenshotQuestion.value.trim() || DEFAULT_SCREENSHOT_QUESTION
  const userMessage = capture.title
    ? `查看当前窗口“${capture.title}”：${question}`
    : `查看当前窗口：${question}`
  const conversation = ensureConversation(userMessage)
  const assistantMessage = { role: 'assistant', content: '' }

  conversation.messages.push({ role: 'user', content: userMessage }, assistantMessage)
  messages.value = conversation.messages
  const messageIndex = conversation.messages.length - 1
  screenshotPreview.value = null
  screenshotQuestion.value = ''
  screenshotBusy.value = true
  isLoading.value = true
  responseStage.value = 'analyzing'
  errorText.value = ''
  stopAllTts()
  abortController = new AbortController()
  if (ttsEnabled.value) ttsAbortController = new AbortController()
  await scrollToBottom(true)

  try {
    const result = await analyzeWindowCapture({
      capture,
      question,
      userId,
      conversationId: conversation.id,
      signal: abortController.signal
    })
    const answer = String(result?.answer || '').trim()
    if (!answer) throw new Error('图片分析服务没有返回内容')

    let audioBlobs = []
    if (ttsEnabled.value) {
      responseStage.value = 'synthesizing'
      const signal = ttsAbortController?.signal || new AbortController().signal
      try {
        audioBlobs = await synthesizeMessageAudio(answer, signal)
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        showToast(error?.message || '语音合成失败，已显示文字回复')
      }
    }

    assistantMessage.content = answer
    conversation.messages[messageIndex] = { ...assistantMessage }
    messages.value = conversation.messages
    await scrollToBottom(true)

    if (audioBlobs.length > 0) {
      const signal = ttsAbortController?.signal || new AbortController().signal
      enqueueAudioBlobs(audioBlobs, messageIndex, signal)
    }
  } catch (error) {
    if (error?.name === 'AbortError') return
    const detail = error?.message || '图片分析失败'
    errorText.value = detail
    assistantMessage.content = `图片分析失败：${detail}`
    conversation.messages[messageIndex] = { ...assistantMessage }
    messages.value = conversation.messages
  } finally {
    screenshotBusy.value = false
    isLoading.value = false
    responseStage.value = 'idle'
    abortController = null
    await scrollToBottom()
  }
}

function clearVoiceMaxTimer() {
  clearTimeout(voiceMaxTimer)
  voiceMaxTimer = null
}

async function beginPushToTalk(event) {
  if (event?.button !== undefined && event.button !== 0) return
  if (
    voiceState.value !== 'idle' ||
    isLoading.value ||
    openingApp.value ||
    screenshotBusy.value ||
    voiceCallActive.value
  ) return
  if (!isVoiceInputSupported()) {
    showToast('当前环境不支持麦克风录音')
    return
  }

  voicePressActive = true
  event?.currentTarget?.setPointerCapture?.(event.pointerId)
  voiceState.value = 'requesting'
  stopAllTts()

  try {
    const session = await startVoiceRecording()
    if (!voicePressActive) {
      await session.cancel()
      voiceState.value = 'idle'
      return
    }
    voiceRecorder = session
    voiceState.value = 'recording'
    voiceMaxTimer = setTimeout(() => void finishPushToTalk(), 60_000)
  } catch (error) {
    voicePressActive = false
    voiceState.value = 'idle'
    const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError'
    showToast(denied ? '麦克风权限未开启' : error?.message || '无法开始录音')
  }
}

async function finishPushToTalk() {
  voicePressActive = false
  if (voiceState.value === 'requesting') return
  if (voiceState.value !== 'recording' || !voiceRecorder) return

  const session = voiceRecorder
  voiceRecorder = null
  clearVoiceMaxTimer()
  voiceState.value = 'transcribing'

  try {
    const audio = await session.stop()
    const result = await transcribeAudio(audio)
    const transcript = String(result?.text || '').trim()
    if (!transcript) throw new Error('没有识别到清晰的语音')

    inputText.value = transcript
    voiceState.value = 'idle'
    await nextTick()
    autoGrow()
    await sendPrompt()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    showToast(detail || '语音识别失败')
  } finally {
    if (voiceState.value === 'transcribing') voiceState.value = 'idle'
  }
}

async function cancelVoiceRecording() {
  voicePressActive = false
  clearVoiceMaxTimer()
  const session = voiceRecorder
  voiceRecorder = null
  if (session) await session.cancel().catch(() => {})
  voiceState.value = 'idle'
}

function onVoicePointerDown(event) {
  void beginPushToTalk(event)
}

function onVoicePointerUp() {
  void finishPushToTalk()
}

function onVoiceKeyDown(event) {
  if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return
  event.preventDefault()
  void beginPushToTalk()
}

function onVoiceKeyUp(event) {
  if (event.key !== ' ' && event.key !== 'Enter') return
  event.preventDefault()
  void finishPushToTalk()
}

async function sendPrompt() {
  const prompt = inputText.value.trim()
  if (
    !prompt ||
    voiceCallActive.value ||
    isLoading.value ||
    openingApp.value ||
    screenshotBusy.value ||
    voiceState.value !== 'idle'
  ) return

  const localCommand = parseOpenApplicationCommand(prompt)

  inputText.value = ''
  await nextTick()
  autoGrow()

  if (localCommand) {
    await handleLocalApplicationCommand(prompt, localCommand)
    return
  }

  const conversation = ensureConversation(prompt)
  messages.value = conversation.messages

  await runStream(conversation, prompt, { appendUser: true })
}

/**
 * 重新生成某条回复。
 *
 * 注意：后端没有「删除单条消息」的接口，重新生成时它会按会话再存一条 user + assistant，
 * 因此刷新页面向数据库回读历史时会看到两条回复。
 */
async function regenerate(index) {
  if (isLoading.value || voiceCallActive.value) return
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

/* ------------------------------------------------------------ 天气 */

function weatherIcon(code, daytime = true) {
  if (code === 0) return daytime ? '☀️' : '🌙'
  if (code <= 2) return daytime ? '🌤️' : '☁️'
  if (code === 3) return '☁️'
  if (code === 45 || code === 48) return '🌫️'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️'
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return '🌨️'
  if (code >= 95) return '⛈️'
  return '🌡️'
}

function shortDate(value, index) {
  if (index === 0) return '今天'
  if (index === 1) return '明天'
  const parts = String(value || '').split('-')
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : value
}

async function fetchWeather(params) {
  weatherLoading.value = true
  weatherError.value = ''
  try {
    const query = new URLSearchParams(params)
    const res = await httpFetch(apiUrl(`/api/weather?${query}`))
    if (!res.ok) throw new Error(await readErrorMessage(res))
    const data = await res.json()
    weatherData.value = data
    weatherLocation.value = String(data.location || '').trim()
    if (weatherLocation.value) {
      localStorage.setItem(weatherLocationKey, weatherLocation.value)
    }
  } catch (error) {
    weatherError.value = error.message || '天气查询失败，请稍后重试'
  } finally {
    weatherLoading.value = false
  }
}

async function searchWeather() {
  const city = weatherCity.value.trim()
  if (!city || weatherLoading.value) return
  localStorage.setItem(weatherCityKey, city)
  await fetchWeather({ city })
}

function locateWeather() {
  if (weatherLoading.value) return
  if (!navigator.geolocation) {
    weatherError.value = '当前浏览器不支持定位，请输入城市查询'
    return
  }
  weatherLoading.value = true
  weatherError.value = ''
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const latitude = position.coords.latitude.toFixed(4)
      const longitude = position.coords.longitude.toFixed(4)
      void fetchWeather({ latitude, longitude })
    },
    (error) => {
      weatherLoading.value = false
      weatherError.value = error.code === 1 ? '定位权限未开启，请输入城市查询' : '暂时无法获取位置，请输入城市查询'
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 }
  )
}

function toggleWeather() {
  weatherOpen.value = !weatherOpen.value
  if (weatherOpen.value && !weatherData.value && weatherCity.value.trim()) void searchWeather()
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
  if (event.key === 'Escape') {
    closeSidebar()
    weatherOpen.value = false
    if (!openingApp.value) pendingAppLaunch.value = null
    cancelScreenshotPreview()
    if (voiceState.value === 'recording' || voiceState.value === 'requesting') {
      void cancelVoiceRecording()
    }
  }
}

watch(inputText, () => nextTick(autoGrow))
watch([weatherLocation, recentApplication], publishVoiceContext)

onMounted(async () => {
  document.documentElement.dataset.theme = theme.value
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('scroll', onScroll, { passive: true })
  if (globalThis.BroadcastChannel) {
    voiceChannel = new BroadcastChannel(VOICE_CHANNEL)
    voiceChannel.onmessage = onVoiceWindowMessage
    voiceHeartbeatTimer = setInterval(() => {
      if (voiceCallActive.value && Date.now() - lastVoiceHeartbeat > 6500) voiceCallActive.value = false
    }, 2000)
  }

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
  clearInterval(voiceHeartbeatTimer)
  voiceChannel?.close()
  void cancelVoiceRecording()
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

      <div v-if="historyLoading" class="history-status" role="status">正在加载历史会话…</div>
      <div v-else-if="historyError" class="history-status history-load-error" role="alert">
        <span>{{ historyError }}</span><button type="button" @click="retryHistory">重试</button>
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
              <button class="icon-mini danger" type="button" title="删除" @click.stop="requestDeleteConversation(conversation)">
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
          <button class="icon-btn" :class="{ on: voiceCallActive }" type="button"
            :disabled="isLoading || openingApp || screenshotBusy || voiceState !== 'idle'"
            title="实时语音通话" aria-label="实时语音通话" @click="startRealtimeCall">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 16.9V20a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/>
            </svg>
          </button>
          <button
            v-if="desktopRuntime"
            class="icon-btn"
            :class="{ on: !!screenshotPreview }"
            type="button"
            :disabled="isLoading || openingApp || screenshotBusy || voiceCallActive || voiceState !== 'idle'"
            title="截图并分析当前窗口"
            aria-label="截图并分析当前窗口"
            @click="openScreenshotPreview"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 7.5h3l1.3-2h7.4l1.3 2h3a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z" />
              <circle cx="12" cy="13" r="3.4" />
            </svg>
          </button>

          <button
            class="icon-btn"
            :class="{ on: weatherOpen }"
            type="button"
            title="查询当地天气"
            aria-label="查询当地天气"
            @click="toggleWeather"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 18h9.5a3.5 3.5 0 0 0 .6-6.95A6.5 6.5 0 0 0 5.7 9.6 4.25 4.25 0 0 0 8 18Z" />
              <path d="M8.6 6.4 7.2 5M13 4V2M4 10H2" />
            </svg>
          </button>

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

        <section v-if="weatherOpen" class="weather-panel" aria-label="当地天气">
          <div class="weather-panel-head">
            <div>
              <strong>当地天气</strong>
              <span>天气数据由 <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> 提供</span>
            </div>
            <button class="weather-close" type="button" aria-label="关闭天气面板" @click="weatherOpen = false">×</button>
          </div>

          <form class="weather-search" @submit.prevent="searchWeather">
            <input v-model="weatherCity" type="search" maxlength="100" placeholder="输入城市，如：杭州" aria-label="城市名称" />
            <button type="submit" :disabled="weatherLoading || !weatherCity.trim()">查询</button>
          </form>
          <button class="weather-locate" type="button" :disabled="weatherLoading" @click="locateWeather">
            <span aria-hidden="true">⌖</span> 使用我的位置
          </button>

          <div v-if="weatherLoading" class="weather-status">正在查询最新天气…</div>
          <div v-else-if="weatherError" class="weather-error">{{ weatherError }}</div>

          <template v-else-if="weatherData">
            <div class="weather-current">
              <span class="weather-symbol">{{ weatherIcon(weatherData.current.weatherCode, weatherData.current.daytime) }}</span>
              <div class="weather-temperature">{{ Math.round(weatherData.current.temperature) }}°</div>
              <div class="weather-current-copy">
                <strong>{{ weatherData.location }}</strong>
                <span>{{ weatherData.current.condition }} · 体感 {{ Math.round(weatherData.current.apparentTemperature) }}°</span>
              </div>
            </div>

            <div class="weather-metrics">
              <span>湿度 {{ weatherData.current.humidity }}%</span>
              <span>风速 {{ Math.round(weatherData.current.windSpeed) }} km/h</span>
              <span>降水 {{ weatherData.current.precipitation }} mm</span>
            </div>

            <div class="weather-forecast">
              <div v-for="(day, index) in weatherData.forecast" :key="day.date" class="weather-day">
                <span>{{ shortDate(day.date, index) }}</span>
                <b>{{ weatherIcon(day.weatherCode) }} {{ Math.round(day.maxTemperature) }}° / {{ Math.round(day.minTemperature) }}°</b>
                <small>降水 {{ day.precipitationProbability }}%</small>
              </div>
            </div>

            <div class="weather-advice">
              <strong>今日建议</strong>
              <ul>
                <li v-for="item in weatherData.advice" :key="item">{{ item }}</li>
              </ul>
            </div>
          </template>
        </section>
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
                  {{ isLoading ? '昔涟正在思考' : '没有返回内容' }}
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
              <span>{{ voiceState === 'recording' ? '正在录音，松开发送' : 'Enter 发送 · Shift + Enter 换行' }}</span>
              <span
                v-if="inputText.length > 2500"
                class="char-count"
                :class="{ warn: inputText.length > MAX_PROMPT_CHARS - 300 }"
              >
                {{ inputText.length }} / {{ MAX_PROMPT_CHARS }}
              </span>
            </div>
          </div>

          <button
            class="voice-button"
            :class="{ recording: voiceState === 'recording', busy: voiceState === 'requesting' || voiceState === 'transcribing' }"
            type="button"
            :disabled="isLoading || openingApp || screenshotBusy || voiceCallActive || voiceState === 'transcribing'"
            :title="voiceButtonTitle"
            :aria-label="voiceButtonTitle"
            @pointerdown.prevent="onVoicePointerDown"
            @pointerup.prevent="onVoicePointerUp"
            @pointercancel.prevent="cancelVoiceRecording"
            @keydown="onVoiceKeyDown"
            @keyup="onVoiceKeyUp"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <rect x="8" y="3" width="8" height="12" rx="4" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
            </svg>
          </button>

          <button
            v-if="isLoading"
            class="send stop"
            type="button"
            :title="responseStage === 'synthesizing' ? '停止语音合成并显示回复' : '停止生成'"
            @click="stopRequest"
          >
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

    <div
      v-if="pendingAppLaunch"
      class="command-overlay"
      role="presentation"
      @click.self="cancelApplicationLaunch"
    >
      <section class="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title">
        <div class="command-app-icon" aria-hidden="true">
          {{ selectedPendingApplication?.icon || '🔎' }}
        </div>
        <div class="command-copy">
          <h2 v-if="selectedPendingApplication" id="command-title">
            打开{{ selectedPendingApplication.label }}？
          </h2>
          <h2 v-else id="command-title">未找到“{{ pendingAppLaunch.target }}”</h2>
          <p v-if="selectedPendingApplication">
            来源：{{ selectedPendingApplication.sourceLabel }}。确认后将在你的电脑上启动该软件。
          </p>
          <p v-else>可以手动选择它的 .exe 文件或开始菜单快捷方式，客户端会记住这台电脑上的位置。</p>
        </div>

        <label v-if="pendingAppLaunch.applications.length > 1" class="command-picker">
          <span>发现多个匹配项</span>
          <select v-model="pendingAppLaunch.selectedApplicationId" :disabled="openingApp">
            <option
              v-for="application in pendingAppLaunch.applications"
              :key="application.id"
              :value="application.id"
            >
              {{ application.label }}（{{ application.sourceLabel }}）
            </option>
          </select>
        </label>

        <div class="command-actions">
          <button type="button" class="command-cancel" :disabled="openingApp" @click="cancelApplicationLaunch">
            取消
          </button>
          <button type="button" class="command-browse" :disabled="openingApp" @click="chooseApplicationFile">
            {{ openingApp ? '处理中…' : '手动选择' }}
          </button>
          <button
            v-if="selectedPendingApplication"
            type="button"
            class="command-confirm"
            :disabled="openingApp"
            @click="confirmApplicationLaunch"
          >
            {{ openingApp ? '正在打开…' : '确认打开' }}
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="screenshotPreview"
      class="command-overlay"
      role="presentation"
      @click.self="cancelScreenshotPreview"
    >
      <section class="command-dialog vision-dialog" role="dialog" aria-modal="true" aria-labelledby="vision-title">
        <div class="vision-heading">
          <div>
            <h2 id="vision-title">确认发送这张窗口截图？</h2>
            <p>{{ screenshotPreview.title || '未命名窗口' }} · {{ screenshotPreview.width }} × {{ screenshotPreview.height }}</p>
          </div>
          <button type="button" class="vision-close" aria-label="关闭" @click="cancelScreenshotPreview">×</button>
        </div>

        <img class="vision-preview" :src="screenshotPreview.imageData" alt="待分析的当前窗口截图" />

        <label class="vision-question">
          <span>你想让 AI 看什么？</span>
          <textarea v-model="screenshotQuestion" rows="3" maxlength="1000"></textarea>
        </label>
        <p class="vision-privacy">截图只会在你确认后上传。发送前请检查是否包含密码、密钥或其他敏感信息。</p>

        <div class="command-actions">
          <button type="button" class="command-cancel" @click="cancelScreenshotPreview">取消</button>
          <button type="button" class="command-browse" @click="openScreenshotPreview">重新截图</button>
          <button type="button" class="command-confirm" @click="analyzeScreenshot">发送并分析</button>
        </div>
      </section>
    </div>

    <ConfirmDeleteDialog v-if="pendingDeleteConversation" :title="pendingDeleteConversation.title"
      :busy="deletingConversation" :error="deleteError" @confirm="removeConversation"
      @cancel="pendingDeleteConversation = null" />

    <div class="toast" :class="{ show: !!toast }" aria-live="polite">{{ toast }}</div>
  </div>
</template>
