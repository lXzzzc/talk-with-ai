<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { resolveChatUser } from './chatIdentity.js'
import { setPetActivity } from './petActivity.js'
import { ASSISTANT_PROFILE, USER_PROFILE } from './characterProfiles.js'
import ProfileAvatar from './ProfileAvatar.vue'
import { streamPetReply } from './petChatClient.js'
import { speak } from './tts.js'

const mode = ref('response')
const greeting = ref('嗯，我在。')
const draft = ref('')
const messages = ref([])
const busy = ref(false)
const speaking = ref(false)
const error = ref('')
const pane = ref(null)
const input = ref(null)
const voiceEnabled = ref(localStorage.getItem('xilian-pet-read-aloud') === 'true')
const userId = resolveChatUser()
const historyKey = `xilian-pet-history:${userId}`
const sessionKey = `xilian-pet-session:${userId}`
let conversationId = localStorage.getItem(sessionKey)
if (!/^[\w-]{1,128}$/.test(conversationId || '')) {
  conversationId = `pet-${crypto.randomUUID()}`
  localStorage.setItem(sessionKey, conversationId)
}
try {
  const history = JSON.parse(localStorage.getItem(historyKey) || '[]')
  if (Array.isArray(history)) messages.value = history.filter(item =>
    ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').slice(-40)
} catch { /* Keep chatting if a previous local cache was invalid. */ }
const status = computed(() => speaking.value ? '轻声回应你' : busy.value ? '让我想一想…' : '我在这里，慢慢说')
const activitySource = Symbol('pet-chat')
const typingSource = Symbol('pet-draft')
let request = null
let voiceRequest = null
let unsubscribe = null
let typingTimer = null
let historyChannel = null
let disposed = false

async function invoke(command, args) { return globalThis.xilianDesktop?.invoke(command, args) }
async function scroll() {
  await nextTick()
  if (pane.value) pane.value.scrollTop = pane.value.scrollHeight
}
function save() {
  try { localStorage.setItem(historyKey, JSON.stringify(messages.value.slice(-40))) } catch { /* Server keeps history. */ }
}
function notifyHistory() {
  historyChannel?.postMessage({ type: 'history', userId, conversationId })
}
function stop() {
  request?.abort()
  voiceRequest?.abort()
  clearTimeout(typingTimer)
  setPetActivity(activitySource, 'idle')
  setPetActivity(typingSource, 'idle')
}
async function applyEvent(event) {
  if (event.type === 'bubble-hidden') { stop(); return }
  if (event.type !== 'bubble-state') return
  mode.value = event.mode
  greeting.value = event.line || '嗯，我在。'
  if (mode.value === 'chat') {
    await scroll()
    input.value?.focus()
  }
}
async function close() { stop(); await invoke('pet_close_bubble') }
async function openChat() { await invoke('pet_open_bubble') }
async function openFullChat() { await invoke('pet_open_chat', { conversationId }) }

async function send() {
  const prompt = draft.value.trim()
  if (!prompt || prompt.length > 4000 || busy.value) return
  voiceRequest?.abort()
  error.value = ''
  draft.value = ''
  busy.value = true
  const controller = new AbortController()
  request = controller
  const timeout = setTimeout(() => controller.abort(new Error('回复等待超时，请稍后再试。')), 90000)
  messages.value.push({ role: 'user', content: prompt }, { role: 'assistant', content: '' })
  const reply = messages.value[messages.value.length - 1]
  clearTimeout(typingTimer)
  setPetActivity(typingSource, 'idle')
  setPetActivity(activitySource, 'thinking')
  await scroll()
  try {
    const text = await streamPetReply({ userId, conversationId, prompt, signal: controller.signal,
      onText: text => { reply.content = text; void scroll() } })
    if (!text.trim()) throw new Error('这次没有收到回复，请稍后再试。')
    save(); notifyHistory()
    // Read-aloud is opt-in. Keep the full written answer even if TTS fails.
    if (voiceEnabled.value && !controller.signal.aborted) {
      busy.value = false
      setPetActivity(activitySource, 'idle')
      void readReply(text)
    }
  } catch (failure) {
    if (!controller.signal.aborted || controller.signal.reason?.name !== 'AbortError') {
      error.value = failure.message || '暂时连接不上，稍后再试试。'
    }
    if (!reply.content) messages.value.splice(messages.value.indexOf(reply), 1)
    save(); notifyHistory()
  } finally {
    clearTimeout(timeout)
    if (request === controller) { request = null; busy.value = false; setPetActivity(activitySource, 'idle') }
    if (!disposed) { await scroll(); input.value?.focus() }
  }
}
async function readReply(text) {
  const controller = new AbortController()
  voiceRequest = controller
  speaking.value = true
  try {
    // Respect the existing TTS endpoint's 480-character limit, preserving order.
    const plain = text.replace(/[`#*_>]/g, '')
    const chunks = plain.match(/[\s\S]{1,450}/g) || []
    for (const chunk of chunks) {
      if (controller.signal.aborted) break
      await speak(chunk, { signal: controller.signal })
    }
  } catch (failure) {
    if (!controller.signal.aborted) error.value = `朗读暂时不可用：${failure.message}`
  } finally {
    if (voiceRequest === controller) { voiceRequest = null; speaking.value = false }
  }
}
watch(draft, value => {
  clearTimeout(typingTimer)
  setPetActivity(typingSource, value.trim() && !busy.value ? 'typing' : 'idle')
  typingTimer = setTimeout(() => setPetActivity(typingSource, 'idle'), 1800)
})
watch(voiceEnabled, value => {
  localStorage.setItem('xilian-pet-read-aloud', String(value))
  if (!value) voiceRequest?.abort()
})
onMounted(async () => {
  if (globalThis.BroadcastChannel) historyChannel = new BroadcastChannel('xilian-pet-chat-v1')
  unsubscribe = globalThis.xilianDesktop?.onPetEvent(applyEvent)
  const state = await invoke('pet_bubble_state')
  if (state) await applyEvent({ type: 'bubble-state', ...state })
  else mode.value = 'chat'
})
onBeforeUnmount(() => { disposed = true; stop(); unsubscribe?.(); historyChannel?.close() })
</script>

<template>
  <main class="pet-bubble" :class="{ compact: mode === 'response' }" :data-mode="mode" @keydown.esc="close">
    <header class="bubble-heading">
      <div class="bubble-person"><span class="bubble-flower">✧</span><strong>昔涟</strong><span v-if="mode === 'chat'" class="bubble-status">{{ status }}</span></div>
      <button class="bubble-icon" type="button" aria-label="关闭气泡" @click="close">×</button>
    </header>
    <template v-if="mode === 'response'">
      <p class="bubble-greeting" aria-live="polite">{{ greeting }}</p>
      <button class="bubble-invite" type="button" @click="openChat">和我说说话 <span>↗</span></button>
    </template>
    <template v-else>
      <section ref="pane" class="bubble-messages" aria-label="与昔涟的对话" aria-live="polite" aria-relevant="additions text">
        <div v-if="!messages.length" class="bubble-empty"><span>✧</span><p>有什么想说的吗？<br>我会在这里，静静听你说。</p></div>
        <article v-for="(message, index) in messages" :key="index" class="bubble-message" :class="message.role">
          <span class="bubble-speaker"><ProfileAvatar :profile="message.role === 'user' ? USER_PROFILE : ASSISTANT_PROFILE" />{{ message.role === 'user' ? USER_PROFILE.name : ASSISTANT_PROFILE.name }}</span>
          <p>{{ message.content || (busy ? '让我想一想…' : '') }}</p>
        </article>
      </section>
      <p v-if="error" class="bubble-error" role="alert">{{ error }}</p>
      <form class="bubble-composer" @submit.prevent="send">
        <textarea ref="input" v-model="draft" rows="2" maxlength="4000" aria-label="想对昔涟说的话"
          placeholder="慢慢说，我在听…" @keydown.enter.exact="!$event.isComposing && ($event.preventDefault(), send())" />
        <div class="bubble-compose-actions"><label><input v-model="voiceEnabled" type="checkbox" />轻声朗读</label>
          <button v-if="busy || speaking" class="bubble-stop" type="button" @click="stop">停止</button>
          <button class="bubble-send" type="submit" :disabled="busy || !draft.trim()">发送 <span>↑</span></button>
        </div>
      </form>
      <footer class="bubble-footer"><span>Shift + Enter 换行</span><button type="button" @click="openFullChat">打开完整对话 ↗</button></footer>
    </template>
  </main>
</template>

<style>
html.pet-chat-view, html.pet-chat-view body, html.pet-chat-view #app { width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; background:transparent!important; }
.pet-bubble { box-sizing:border-box; height:calc(100vh - 16px); margin:8px; padding:17px 17px 12px; display:flex; flex-direction:column; color:#533d65; background:linear-gradient(145deg,#fff9fff7,#eee5f9fa); border:1px solid #ffffffd9; border-radius:23px; box-shadow:0 3px 7px #38204624; font:13px/1.7 'Microsoft YaHei','Segoe UI',sans-serif; }
.bubble-heading,.bubble-person,.bubble-compose-actions,.bubble-footer { display:flex; align-items:center; justify-content:space-between; gap:9px; }
.bubble-heading { padding-bottom:10px; flex-shrink:0; }
.bubble-person { justify-content:flex-start; gap:7px; }
.bubble-person strong { font-size:15px; font-weight:600; letter-spacing:2px; }
.bubble-flower { color:#a976bf; font-size:23px; }
.bubble-status { font-size:10px; color:#957f9d; margin-left:4px; }
.pet-bubble button { font:inherit; cursor:pointer; border:0; }
.bubble-icon { width:25px; height:25px; border-radius:50%; background:#b38bc914; color:#856b92; font-size:19px!important; line-height:1; }
.bubble-greeting { margin:3px 0 8px; font-size:16px; letter-spacing:.4px; }
.bubble-invite { align-self:flex-start; padding:0; background:transparent; color:#9471ab; font-size:11px!important; }
.bubble-invite span { margin-left:12px; }
.bubble-messages { flex:1; min-height:0; overflow:auto; scrollbar-width:thin; scrollbar-color:#cbb6d8 transparent; padding:4px 3px 10px; }
.bubble-empty { text-align:center; color:#a08ba9; padding:24px 0; }
.bubble-empty>span { font-size:37px; color:#be9ed0; }
.bubble-empty p { line-height:2; font-size:12px; }
.bubble-message { margin:0 0 14px; }
.bubble-message p { white-space:pre-wrap; overflow-wrap:anywhere; margin:4px 0 0; padding:9px 12px; background:#ffffffac; border-radius:4px 14px 14px; }
.bubble-message.user { margin-left:29px; }
.bubble-message.assistant { margin-right:10px; }
.bubble-message.user p { background:#dfcdea77; border-radius:14px 4px 14px 14px; }
.bubble-speaker { display:flex; align-items:center; gap:5px; font-size:10px; color:#9d85aa; }
.bubble-speaker .profile-avatar { width:24px; height:24px; }
.bubble-error { color:#9f526c; font-size:11px; margin:4px 0 8px; max-height:64px; overflow:auto; }
.bubble-composer { flex-shrink:0; padding:10px; background:#fffcffb3; border:1px solid #c4a8d14d; border-radius:15px; }
.bubble-composer textarea { box-sizing:border-box; display:block; resize:none; width:100%; min-height:46px; max-height:90px; padding:0; border:0; outline:none; background:transparent; color:#543c67; font:12px/1.7 'Microsoft YaHei',sans-serif; }
.bubble-composer textarea::placeholder { color:#ad98b5; }
.bubble-composer:focus-within { border-color:#b090c7; }
.bubble-compose-actions { margin-top:5px; gap:6px; }
.bubble-compose-actions label { display:flex; align-items:center; margin-right:auto; font-size:10px; color:#9b82a8; cursor:pointer; gap:3px; }
.bubble-compose-actions input { accent-color:#ac82c2; width:12px; height:12px; }
.bubble-send { padding:5px 12px; border-radius:10px; color:white; background:linear-gradient(100deg,#a783bb,#c098c5); font-size:11px!important; }
.bubble-send:disabled { opacity:.4; cursor:default; }
.bubble-stop { color:#976a89; background:transparent; font-size:11px!important; padding:5px; }
.bubble-footer { font-size:9px; color:#ad99b7; margin-top:8px; }
.bubble-footer button { background:transparent; color:#9b7eac; padding:0; font-size:10px; }
.pet-bubble button:focus-visible { outline:2px solid #a783bb; outline-offset:2px; }
.pet-bubble { color-scheme:light; }
</style>
