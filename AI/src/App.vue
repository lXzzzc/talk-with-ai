<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { speak } from './edge-tts.js'

const endpoint = '/api/ai/chat'
const chatType = 'chat'
const storageKey = 'spring-ai-test-conversations'

const conversations = ref([])
const activeConversationId = ref('')
const inputText = ref('')
const messages = ref([])
const isLoading = ref(false)
const errorText = ref('')
const chatBodyRef = ref(null)

let abortController = null
let ttsAbortController = null
const ttsQueue = []
let ttsPlaying = false

const canSend = computed(() => inputText.value.trim().length > 0 && !isLoading.value)
const ttsEnabled = ref(true)
const ttsSpokenPositions = ref({})

function createConversationId() {
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

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

function newChat() {
  stopRequest()
  stopAllTts()
  activeConversationId.value = createConversationId()
  inputText.value = ''
  messages.value = []
  errorText.value = ''
}

async function selectConversation(conversation) {
  stopRequest()
  stopAllTts()
  activeConversationId.value = conversation.id
  messages.value = conversation.messages
  errorText.value = ''

  if (conversation.messages.length > 0) return

  try {
    const res = await fetch(`/api/${chatType}/${encodeURIComponent(conversation.id)}`)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
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
    await scrollToBottom()
  } catch (error) {
    errorText.value = error.message || '加载历史失败'
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

function buildUrl(prompt) {
  const url = new URL(endpoint, window.location.origin)
  url.searchParams.set('prompt', prompt)
  url.searchParams.set('conversationId', activeConversationId.value)
  return url
}

async function scrollToBottom() {
  await nextTick()
  if (chatBodyRef.value) {
    chatBodyRef.value.scrollTop = chatBodyRef.value.scrollHeight
  }
}

function stopRequest() {
  abortController?.abort()
}

function stopAllTts() {
  ttsAbortController?.abort()
  ttsQueue.length = 0
  ttsPlaying = false
  ttsSpokenPositions.value = {}
}

const SENTENCE_RE = /[^。！？.!?\n]+[。！？.!?\n]+/g

function processTtsQueue() {
  if (ttsPlaying || ttsQueue.length === 0) return
  ttsPlaying = true
  const { text, signal } = ttsQueue.shift()
  speak(text, { signal })
    .catch(() => {})
    .finally(() => {
      ttsPlaying = false
      processTtsQueue()
    })
}

function speakNewSentences(messageIndex, content) {
  if (!ttsEnabled.value) return
  const lastPos = ttsSpokenPositions.value[messageIndex] || 0
  if (lastPos >= content.length) return

  const newText = content.slice(lastPos)
  const sentences = []
  let match
  while ((match = SENTENCE_RE.exec(newText)) !== null) {
    sentences.push(match[0])
  }
  SENTENCE_RE.lastIndex = 0

  if (sentences.length === 0) return

  let spokenEnd = lastPos
  for (const s of sentences) {
    spokenEnd = content.indexOf(s, spokenEnd) + s.length
  }
  ttsSpokenPositions.value = { ...ttsSpokenPositions.value, [messageIndex]: spokenEnd }

  if (!ttsAbortController || ttsAbortController.signal.aborted) {
    ttsAbortController = new AbortController()
  }

  for (const s of sentences) {
    ttsQueue.push({ text: s.trim(), signal: ttsAbortController.signal })
  }
  processTtsQueue()
}

async function sendPrompt() {
  const prompt = inputText.value.trim()
  if (!prompt || isLoading.value) return

  const conversation = ensureConversation(prompt)
  messages.value = conversation.messages
  inputText.value = ''
  errorText.value = ''
  isLoading.value = true
  abortController = new AbortController()

  stopAllTts()
  ttsAbortController = new AbortController()

  conversation.messages.push({ role: 'user', content: prompt })
  const assistantMessage = { role: 'assistant', content: '' }
  conversation.messages.push(assistantMessage)
  await scrollToBottom()

  try {
    const res = await fetch(buildUrl(prompt), {
      method: 'GET',
      signal: abortController.signal,
      headers: {
        Accept: 'text/html;charset=utf-8'
      }
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }

    if (!res.body) {
      assistantMessage.content = await res.text()
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      assistantMessage.content += decoder.decode(value, { stream: true })
      conversation.messages[conversation.messages.length - 1] = { ...assistantMessage }
      messages.value = conversation.messages
      speakNewSentences(conversation.messages.length - 1, assistantMessage.content)
      await scrollToBottom()
    }

    assistantMessage.content += decoder.decode()
    conversation.messages[conversation.messages.length - 1] = { ...assistantMessage }
    messages.value = conversation.messages
    speakNewSentences(conversation.messages.length - 1, assistantMessage.content)
  } catch (error) {
    if (error.name === 'AbortError') {
      return
    }
    errorText.value = error.message || '请求失败'
    assistantMessage.content = '请求失败，请确认后端服务已启动。'
  } finally {
    isLoading.value = false
    abortController = null
    await scrollToBottom()
  }
}

function handleEnter(event) {
  if (!event.shiftKey) {
    event.preventDefault()
    sendPrompt()
  }
}

function toggleTts() {
  ttsEnabled.value = !ttsEnabled.value
  if (!ttsEnabled.value) {
    stopAllTts()
  }
}

onMounted(async () => {
  conversations.value = loadConversations()
  if (conversations.value.length > 0) {
    await selectConversation(conversations.value[0])
  } else {
    newChat()
  }
})
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <button class="new-chat" type="button" @click="newChat">+ 新建对话</button>

      <div class="history-title">历史记录</div>
      <div class="history-list">
        <button
          v-for="conversation in conversations"
          :key="conversation.id"
          class="history-item"
          :class="{ active: conversation.id === activeConversationId }"
          type="button"
          @click="selectConversation(conversation)"
        >
          {{ conversation.title }}
        </button>
        <div v-if="conversations.length === 0" class="empty-history">暂无历史</div>
      </div>
    </aside>

    <main class="chat-panel">
      <header class="chat-header">
        <h1>AI 对话</h1>
        <button class="tts-toggle" type="button" @click="toggleTts" :title="ttsEnabled ? '关闭朗读' : '开启朗读'">
          {{ ttsEnabled ? '🔊' : '🔇' }}
        </button>
      </header>

      <section ref="chatBodyRef" class="chat-body">
        <div v-if="messages.length === 0" class="welcome">输入问题开始对话</div>

        <article v-for="(message, index) in messages" :key="index" class="message" :class="message.role">
          <div class="bubble">
            <span v-if="message.role === 'assistant' && !message.content && isLoading" class="typing">正在生成...</span>
            <template v-else>{{ message.content }}</template>
          </div>
        </article>

        <div v-if="errorText" class="error">{{ errorText }}</div>
      </section>

      <form class="composer" @submit.prevent="sendPrompt">
        <textarea
          v-model="inputText"
          rows="1"
          placeholder="输入消息，Enter 发送，Shift + Enter 换行"
          @keydown.enter="handleEnter"
        ></textarea>
        <button v-if="isLoading" class="send" type="button" @click="stopRequest">停止</button>
        <button v-else class="send" type="submit" :disabled="!canSend">发送</button>
      </form>
    </main>
  </div>
</template>
