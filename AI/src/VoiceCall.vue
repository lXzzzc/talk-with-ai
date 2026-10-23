<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { setPetSpeaking } from './petSpeech.js'
import { setPetActivity } from './petActivity.js'
import { ASSISTANT_PROFILE, USER_PROFILE } from './characterProfiles.js'
import ProfileAvatar from './ProfileAvatar.vue'
import { RealtimeVoiceCall } from './realtimeVoice.js'
import { formatCallDuration } from './voiceProtocol.js'
import { VOICE_CHANNEL, VOICE_CONTEXT_KEY } from './voiceCallWindow.js'

const status = ref('idle')
const speechId = Symbol('voice-call')
watch(status, value => {
  setPetSpeaking(speechId, value === 'speaking')
  setPetActivity(speechId, ['hearing', 'listening'].includes(value) ? 'listening'
    : ['thinking', 'connecting'].includes(value) ? 'thinking' : 'idle')
})
const muted = ref(false)
const subtitles = ref(true)
const level = ref(0)
const duration = ref(0)
const error = ref('')
const draft = ref('')
const transcript = ref([])
const transcriptPane = ref(null)
const location = ref('')
const conversationId = new URLSearchParams(window.location.search).get('conversationId') || ''
const statusLabels = {
  idle: '让声音，靠近一点', connecting: '正在连接…', listening: '我在听，你说吧',
  hearing: '正在听你说', thinking: '正在想怎么回答你', speaking: '昔涟正在说话',
  ended: '通话已结束', error: '连接暂时中断'
}
const active = computed(() => !['idle', 'ended', 'error'].includes(status.value))
const statusText = computed(() => muted.value && active.value ? '麦克风已静音' : statusLabels[status.value])
const timerText = computed(() => formatCallDuration(duration.value))
let call = null
let context = null
let channel = null
let ticker = null
let heartbeat = null
let startedAt = 0
let disposed = false

function readContext() {
  try {
    const value = JSON.parse(localStorage.getItem(VOICE_CONTEXT_KEY) || '{}')
    if (value.conversationId === conversationId && value.userId) return value
  } catch { /* 无效本地配置会在拨打时明确提示。 */ }
  return null
}

function announce(windowOpen = true) {
  channel?.postMessage({ type: 'voice.status', conversationId, userId: context?.userId,
    active: active.value, windowOpen, at: Date.now() })
}

function syncContext() {
  const latest = readContext()
  if (!latest || (context && latest.userId !== context.userId)) return
  context = latest
  location.value = latest.weatherLocation || ''
  call?.updateContext({ weatherLocation: latest.weatherLocation, clientContext: latest.clientContext })
}

function updateReply(event) {
  let message = transcript.value.find(item => item.role === 'assistant' && item.turnId === event.turnId)
  if (!message) {
    message = { role: 'assistant', text: '', turnId: event.turnId }
    transcript.value.push(message)
    message = transcript.value[transcript.value.length - 1]
  }
  return message
}

function onEvent(event) {
  if (disposed) return
  switch (event.type) {
    case 'ready':
      status.value = 'listening'
      startedAt = Date.now()
      break
    case 'speech.start': status.value = 'hearing'; draft.value = ''; break
    case 'speech.stop': status.value = 'thinking'; break
    case 'transcript.partial': draft.value = event.text; break
    case 'transcript.final':
      draft.value = ''
      transcript.value.push({ role: 'user', text: event.text, turnId: event.turnId })
      status.value = 'thinking'
      break
    case 'reply.delta': updateReply(event).text += event.text; break
    case 'audio.delta': status.value = 'speaking'; break
    case 'listening':
    case 'playback.done': status.value = 'listening'; break
    case 'interrupted': {
      const message = transcript.value.find(item => item.role === 'assistant' && item.turnId === event.turnId)
      if (message) message.interrupted = true
      break
    }
    case 'turn.end':
      if (event.interrupted) {
        const message = transcript.value.find(item => item.role === 'assistant' && item.turnId === event.turnId)
        if (message) message.interrupted = true
      }
      if (!['hearing', 'thinking'].includes(status.value)) status.value = 'listening'
      channel?.postMessage({ type: 'voice.history', conversationId, userId: context?.userId })
      break
    case 'turn.error':
    case 'notice': error.value = event.message; status.value = 'listening'; break
    case 'error':
      error.value = event.message
      status.value = 'error'
      muted.value = false
      level.value = 0
      break
    default: break
  }
  // 限制通话字幕的内存，完整文字记录仍以数据库为准。
  if (transcript.value.length > 80) transcript.value.splice(0, transcript.value.length - 80)
  announce()
  void nextTick(() => {
    if (transcriptPane.value) transcriptPane.value.scrollTop = transcriptPane.value.scrollHeight
  })
}

async function begin() {
  if (active.value) return
  syncContext()
  if (!context) { error.value = '请从主聊天页面点击电话按钮打开通话'; return }
  call?.stop()
  error.value = ''
  draft.value = ''
  duration.value = 0
  muted.value = false
  startedAt = 0
  status.value = 'connecting'
  announce()
  const current = new RealtimeVoiceCall({ context, onEvent,
    onLevel: value => { level.value = Math.min(1, value * 9) } })
  call = current
  try { await current.start() }
  catch (failure) {
    if (call !== current || disposed || status.value === 'ended') return
    error.value = failure.message || '无法开始通话'
    status.value = 'error'
    announce()
  }
}

function hangup() {
  call?.stop()
  call = null
  status.value = 'ended'
  muted.value = false
  draft.value = ''
  level.value = 0
  announce()
  channel?.postMessage({ type: 'voice.history', conversationId, userId: context?.userId })
}

function toggleMute() {
  muted.value = !muted.value
  call?.setMuted(muted.value)
  if (muted.value) level.value = 0
}

function interrupt() { call?.interrupt() }

function dispose() {
  if (disposed) return
  hangup()
  setPetSpeaking(speechId, false)
  setPetActivity(speechId, 'idle')
  announce(false)
  disposed = true
  clearInterval(ticker)
  clearInterval(heartbeat)
  window.removeEventListener('storage', syncContext)
  window.removeEventListener('pagehide', dispose)
  channel?.close()
}

onMounted(async () => {
  document.title = '与昔涟通话'
  document.body.classList.add('voice-call-body')
  context = readContext()
  syncContext()
  if (globalThis.BroadcastChannel) {
    channel = new BroadcastChannel(VOICE_CHANNEL)
    channel.onmessage = event => {
      if (event.data?.type === 'voice.context') syncContext()
      if (event.data?.type === 'voice.hangup' && event.data.conversationId === conversationId) hangup()
    }
  }
  announce()
  window.addEventListener('storage', syncContext)
  window.addEventListener('pagehide', dispose)
  ticker = setInterval(() => {
    if (active.value && startedAt) duration.value = (Date.now() - startedAt) / 1000
  }, 1000)
  heartbeat = setInterval(() => announce(), 2000)
})

onBeforeUnmount(() => { dispose(); document.body.classList.remove('voice-call-body') })
</script>

<template>
  <main class="call-screen" :class="{ 'is-speaking': status === 'speaking', 'is-listening': status === 'hearing' }">
    <div class="call-atmosphere" aria-hidden="true"><span class="call-water-ripples"></span><span class="call-sparkle sparkle-one">✧</span><span class="call-sparkle sparkle-two">✦</span></div>
    <header class="call-topbar">
      <span class="call-brand"><span class="call-brand-dot"></span> 昔涟 · 实时语音</span>
      <span class="call-live-badge">{{ active ? '通话中' : '语音陪伴' }}</span>
    </header>

    <section class="call-person" aria-label="通话对象">
      <div class="call-avatar-wrap" :style="{ '--voice-level': level }">
        <div class="call-orbit orbit-one"></div><div class="call-orbit orbit-two"></div>
        <ProfileAvatar class="call-avatar" :profile="ASSISTANT_PROFILE" />
        <img class="call-avatar-frame" src="/xilian-call-avatar-frame-v1.png" alt="" aria-hidden="true" draggable="false" />
        <span class="call-online"></span>
      </div>
      <h1>昔涟</h1>
      <p class="call-person-note">无论远近，我都会听见你</p>
      <div class="call-status" role="status" aria-live="polite">
        <span v-if="active" class="call-status-dot" :class="{ muted }"></span>{{ statusText }}
      </div>
      <time class="call-timer">{{ timerText }}</time>
      <div class="call-wave" :class="{ quiet: !active || muted }" aria-hidden="true">
        <i v-for="i in 19" :key="i" :style="{ '--bar': i, '--level': level }"></i>
      </div>
    </section>

    <div class="call-caption-stage">
      <img v-if="subtitles" class="call-caption-mascot" src="/xilian-dialog-perch-v1.png" alt="" aria-hidden="true" draggable="false" />
    <section v-if="subtitles" class="call-caption-box" aria-label="通话字幕">
      <div class="call-caption-heading"><span>实时字幕</span><span>{{ location ? `⌖ ${location}` : '声音连接着我们' }}</span></div>
      <div ref="transcriptPane" class="call-caption-scroll">
        <p v-if="!transcript.length && !draft" class="call-caption-empty">
          <span class="call-caption-flower" aria-hidden="true">✧</span>
          {{ active ? '直接说话就好，停顿后我会回答你。' : '准备好时，开始我们的通话吧。' }}
        </p>
        <div v-for="(message, index) in transcript" :key="index" class="call-caption-line" :class="message.role">
          <span>{{ message.role === 'user' ? USER_PROFILE.name : ASSISTANT_PROFILE.name }}</span>
          <p>{{ message.text }}<small v-if="message.interrupted">已打断</small></p>
        </div>
        <div v-if="draft" class="call-caption-line user draft"><span>{{ USER_PROFILE.name }}</span><p>{{ draft }}<b>…</b></p></div>
      </div>
    </section>
    <div v-else class="call-caption-hidden">字幕已隐藏，你依然可以直接和我说话</div>
    </div>

    <p v-if="error" class="call-error" role="alert">{{ error }}</p>

    <footer class="call-bottom">
      <div class="call-secondary-controls">
        <button type="button" class="call-control" :class="{ selected: muted }" :disabled="!active" :aria-pressed="muted" @click="toggleMute">
          <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/><path v-if="muted" d="m3 3 18 18"/></svg></span>
          {{ muted ? '取消静音' : '静音' }}
        </button>
        <button type="button" class="call-control" :class="{ selected: subtitles }" :aria-pressed="subtitles" @click="subtitles = !subtitles">
          <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="4"/><path d="M7 10h4M7 14h3M14 10h3M13 14h4"/></svg></span>字幕
        </button>
        <button type="button" class="call-control" :disabled="!active || !['speaking', 'thinking'].includes(status)" @click="interrupt">
          <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M8 11V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v8c0 4-2 7-6 7h-1c-2 0-3-1-5-3l-4-5a2 2 0 0 1 3-3l1 1"/></svg></span>打断
        </button>
      </div>
      <button v-if="active" class="call-main-button hangup" type="button" aria-label="挂断通话" @click="hangup">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.3 15.7c-.8-.1-1.3-.7-1.3-1.5v-2.4c0-.5.3-1 .7-1.3a18.4 18.4 0 0 1 18.6 0c.4.3.7.8.7 1.3v2.4c0 .8-.5 1.4-1.3 1.5l-3 .4c-.8.1-1.5-.5-1.6-1.3l-.3-2.3a13.8 13.8 0 0 0-9 0l-.3 2.3c-.1.8-.8 1.4-1.6 1.3z"/></svg>结束通话
      </button>
      <button v-else class="call-main-button dial" type="button" @click="begin">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9V20a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/></svg>{{ status === 'idle' ? '开始通话' : '再次拨打' }}
      </button>
      <p class="call-footnote">{{ active ? '可以随时开口打断我 · 挂断即停止录音' : '点击开始后使用麦克风 · 默认不保存录音' }}</p>
    </footer>
  </main>
</template>

<style>
.voice-call-body { margin: 0; min-width: 320px; background: #100d19 !important; }
.voice-call-body #app { min-height: 100dvh; }
.call-screen { --call-pink: #edb5d1; width: 100%; max-width: 560px; height: 100dvh; min-height: 520px; margin: 0 auto; padding: 26px 30px 22px; display: flex; flex-direction: column; color: #f8eef7; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; background: radial-gradient(ellipse at 35% 22%, #56324a70, transparent 54%), radial-gradient(ellipse at 100% 80%, #37304c70, transparent 58%), #14111f; box-sizing: border-box; }
.call-topbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; color: #b9a7b9; letter-spacing: .5px; }
.call-brand { display: inline-flex; gap: 8px; align-items: center; }
.call-brand-dot { width: 5px; height: 5px; background: #e3abc8; border-radius: 50%; box-shadow: 0 0 12px #e3abc899; }
.call-live-badge { padding: 5px 9px; border: 1px solid #e4b2d21f; border-radius: 20px; font-size: 10px; }
.call-person { padding-top: 29px; text-align: center; flex-shrink: 0; }
.call-avatar-wrap { --voice-level: 0; width: 110px; height: 110px; margin: 0 auto 20px; position: relative; }
.call-avatar { position: relative; width: 100%; height: 100%; object-fit: cover; border-radius: 50%; border: 3px solid #e2adcc80; box-shadow: 0 14px 50px #0006, 0 0 32px #e2adcc22; }
.call-orbit { position: absolute; inset: -10px; border: 1px solid #dca5c125; border-radius: 50%; transition: transform .12s; transform: scale(calc(1 + var(--voice-level) * .1)); }
.orbit-two { inset: -22px; border-style: dashed; border-color: #dca5c115; }
.is-speaking .call-orbit { animation: call-orbit-breathe 2s ease-in-out infinite; }
.call-online { position: absolute; bottom: 3px; right: 7px; width: 12px; height: 12px; border-radius: 50%; background: #c2d9bb; border: 3px solid #261d2b; }
.call-person h1 { margin: 0 0 8px; font-size: 30px; font-weight: 500; letter-spacing: 6px; padding-left: 6px; }
.call-person-note { font-size: 11px; color: #a18c9f; letter-spacing: 2px; margin: 0; }
.call-status { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 24px; margin-top: 20px; color: #e5cddd; font-size: 13px; }
.call-status-dot { background: #c8d8bf; width: 5px; height: 5px; border-radius: 50%; animation: call-pulse 1.5s infinite; }
.call-status-dot.muted { background: #bb9caa; animation: none; }
.call-timer { display: block; margin-top: 3px; color: #aa94a8; font-size: 12px; font-variant-numeric: tabular-nums; letter-spacing: 2px; }
.call-wave { display: flex; align-items: center; justify-content: center; height: 32px; gap: 4px; margin: 12px 0 15px; }
.call-wave i { width: 3px; height: calc(5px + var(--level) * 20px); max-height: 28px; border-radius: 8px; background: #dfadc9; animation: call-wave 1.2s ease-in-out infinite; animation-delay: calc(var(--bar) * -.12s); opacity: .7; }
.call-wave.quiet i { animation: none; height: 3px; opacity: .28; }
.is-speaking .call-wave i { height: 18px; }
.call-caption-box { background: #ffffff04; border: 1px solid #d1a3c015; border-radius: 18px; overflow: hidden; flex: 1; min-height: 110px; display: flex; flex-direction: column; }
.call-caption-heading { display: flex; justify-content: space-between; gap: 12px; padding: 13px 16px 10px; color: #b49aac; font-size: 10px; letter-spacing: 1px; }
.call-caption-heading span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #857485; max-width: 65%; }
.call-caption-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 16px 14px; scrollbar-width: thin; scrollbar-color: #c49cb033 transparent; }
.call-caption-empty { text-align: center; color: #a38c9f; padding: 24px 0 0; font-size: 12px; line-height: 1.8; }
.call-caption-line { display: flex; gap: 10px; margin: 10px 0 14px; font-size: 12px; line-height: 1.8; }
.call-caption-line > span { flex: 0 0 28px; color: #e3b1cd; font-size: 11px; padding-top: 1px; }
.call-caption-line p { margin: 0; color: #ebdce7; white-space: pre-wrap; overflow-wrap: anywhere; }
.call-caption-line.user p, .call-caption-line.user > span { color: #a795aa; }
.call-caption-line.draft { opacity: .65; }
.call-caption-line small { display: inline-block; font-size: 9px; color: #be96a5; border: 1px solid #be96a533; border-radius: 4px; padding: 0 5px; margin-left: 6px; }
.call-caption-hidden { flex: 1; min-height: 142px; display: grid; place-items: center; font-size: 12px; color: #a38c9f; }
.call-error { padding: 10px 12px; margin: 10px 0 0; background: #c55e6c17; border: 1px solid #c55e6c33; color: #f0b7bd; font-size: 12px; line-height: 1.7; border-radius: 10px; }
.call-bottom { padding-top: 20px; flex-shrink: 0; }
.call-secondary-controls { display: flex; justify-content: center; gap: 38px; margin-bottom: 20px; }
.call-control { background: none; border: none; color: #b6a0b3; font: inherit; font-size: 11px; cursor: pointer; padding: 0; display: flex; flex-direction: column; align-items: center; gap: 9px; }
.call-control > span { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: #ffffff07; border: 1px solid #d5aac415; transition: background .2s; }
.call-control svg { width: 21px; height: 21px; }
.call-control.selected > span { background: #edb5d11b; color: #f0c3dd; border-color: #edb5d12a; }
.call-control:hover:not(:disabled) > span { background: #edb5d12e; }
.call-control:disabled { cursor: default; opacity: .35; }
.call-main-button { border: none; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; height: 54px; border-radius: 18px; cursor: pointer; font: inherit; font-size: 14px; letter-spacing: 2px; transition: transform .2s, filter .2s; }
.call-main-button svg { width: 23px; height: 23px; }
.call-main-button:hover { transform: translateY(-1px); filter: brightness(1.08); }
.call-main-button.dial { color: #30202f; background: linear-gradient(110deg, #edc2d9, #d2bded); box-shadow: 0 8px 35px #dcacc522; }
.call-main-button.hangup { color: #fff0f3; background: #bd5267; box-shadow: 0 8px 35px #b4455d22; }
.call-footnote { text-align: center; font-size: 10px; color: #8e798e; margin: 13px 0 0; letter-spacing: .4px; }
.call-control:focus-visible, .call-main-button:focus-visible { outline: 2px solid #f0c3dd; outline-offset: 5px; }
@keyframes call-orbit-breathe { 50% { transform: scale(1.06); opacity: .6; } }
@keyframes call-pulse { 50% { opacity: .35; } }
@keyframes call-wave { 50% { transform: scaleY(.35); } }
@media (max-height: 720px) { .call-screen { padding-top: 18px; padding-bottom: 16px; } .call-person { padding-top: 26px; } .call-avatar-wrap { width: 96px; height: 96px; margin-bottom: 18px; } .call-status { margin-top: 14px; } .call-wave { margin: 9px 0 12px; } .call-bottom { padding-top: 17px; } .call-secondary-controls { margin-bottom: 18px; } .call-caption-scroll { height: 105px; } }
@media (max-height: 640px), (max-width: 380px) {
  .call-screen { padding: 16px 20px 14px; }
  .call-topbar { font-size: 10px; }
  .call-live-badge { font-size: 9px; padding: 4px 7px; }
  .call-person { padding-top: 14px; }
  .call-avatar-wrap { width: 72px; height: 72px; margin-bottom: 12px; }
  .call-orbit { inset: -6px; } .orbit-two { inset: -13px; }
  .call-person h1 { font-size: 24px; margin-bottom: 6px; letter-spacing: 4px; }
  .call-person-note { font-size: 10px; letter-spacing: 1px; }
  .call-status { margin-top: 10px; min-height: 18px; font-size: 12px; }
  .call-timer { font-size: 10px; }
  .call-wave { height: 18px; margin: 6px 0 8px; gap: 3px; }
  .call-wave i { width: 2px; }
  .call-caption-box, .call-caption-hidden { min-height: 78px; }
  .call-caption-heading { padding: 10px 12px 7px; font-size: 9px; letter-spacing: .5px; }
  .call-caption-scroll { height: auto; padding: 0 12px 10px; }
  .call-caption-empty { padding-top: 8px; font-size: 11px; }
  .call-caption-line { font-size: 11px; gap: 8px; margin: 7px 0 10px; }
  .call-bottom { padding-top: 12px; }
  .call-secondary-controls { gap: 30px; margin-bottom: 12px; }
  .call-control { font-size: 10px; gap: 5px; }
  .call-control > span { width: 36px; height: 36px; }
  .call-control svg { width: 18px; height: 18px; }
  .call-main-button { height: 44px; border-radius: 14px; font-size: 13px; }
  .call-main-button svg { width: 20px; height: 20px; }
  .call-footnote { font-size: 9px; margin-top: 10px; }
  .call-error { margin-top: 7px; padding: 7px 10px; font-size: 11px; }
}
@media (prefers-reduced-motion: reduce) { .call-screen * { animation: none !important; transition: none !important; } }

/* Xilian's reference art supplies the ornament; controls and subtitles stay unobstructed. */
.call-screen { position: relative; isolation: isolate; min-height: 0; overflow-x: hidden; overflow-y: auto; background: radial-gradient(ellipse at 30% 12%,#56385085,transparent 52%),radial-gradient(ellipse at 100% 85%,#4a3b6266,transparent 54%),#171222; }
.call-atmosphere { position: absolute; z-index: -1; inset: 0; overflow: hidden; pointer-events: none; }
.call-atmosphere::before { content: ''; position: absolute; width: 330px; height: 310px; top: -65px; left: -180px; background: url('/xilian-bubble-corner-v1.png') center/contain no-repeat; opacity: .09; transform: rotate(28deg); }
.call-atmosphere::after { content: ''; position: absolute; width: 310px; height: 290px; bottom: -110px; right: -140px; background: url('/xilian-bubble-corner-v1.png') center/contain no-repeat; opacity: .075; transform: rotate(180deg); }
.call-water-ripples { position: absolute; width: 490px; height: 230px; border: 1px solid #cfb1e31f; border-radius: 50%; left: 50%; bottom: -130px; transform: translateX(-50%); box-shadow: 0 0 0 20px #c3a8e006,0 0 0 42px #c3a8e006,0 0 0 68px #c3a8e004; }
.call-sparkle { position: absolute; font-size: 18px; color: #d0b2df60; }
.call-sparkle.sparkle-one { top: 22%; left: 11%; }
.call-sparkle.sparkle-two { top: 33%; right: 12%; font-size: 10px; opacity: .7; }
.call-topbar { position: relative; z-index: 1; flex-shrink: 0; }
.call-live-badge { color: #d5bfdc; background: #d4b3e10a; border-color: #e4b2d22b; }
.call-person { padding-top: 45px; }
.call-avatar-wrap { margin-bottom: 36px; }
.call-avatar { z-index: 1; border-width: 2px; box-shadow: 0 8px 35px #0b031a66,0 0 35px #c9a9e41f; }
.call-avatar-frame { position: absolute; z-index: 2; width: 158%; height: 158%; max-width: none; left: -29%; top: -29%; object-fit: contain; pointer-events: none; filter: drop-shadow(0 3px 8px #b47fc022); }
.call-online { z-index: 3; right: 1px; bottom: 7px; box-shadow: 0 0 10px #bfd5c144; }
.call-orbit { inset: -24px; border-color: #dca5c118; }
.call-orbit.orbit-two { inset: -37px; border-style: dashed; opacity: .55; }
.call-person h1 { font-size: 28px; color: #f5e7f7; text-shadow: 0 0 25px #dba2da22; }
.call-person-note { color: #b5a0b7; font-size: 11px; letter-spacing: 1.5px; }
.call-status { margin-top: 17px; }
.call-wave { margin-bottom: 4px; }
.call-caption-stage { flex: 1; min-height: 140px; position: relative; display: flex; flex-direction: column; margin-top: 29px; }
.call-caption-mascot { position: absolute; z-index: 2; width: 104px; height: auto; right: 12px; top: -53px; pointer-events: none; filter: drop-shadow(0 5px 8px #10051b33); }
.call-caption-box { border: 1px solid #d3aed032; background: linear-gradient(145deg,#ffffff08,#d9b8ee04); box-shadow: inset 0 1px #fff0ff08,0 8px 24px #09041316; }
.call-caption-heading { padding-top: 16px; color: #d2b4cd; }
.call-caption-heading > span:first-child::before { content: '✧'; margin-right: 6px; color: #ddbadc; }
.call-caption-heading span:last-child { color: #a48da7; }
.call-caption-scroll { height: auto; }
.call-caption-empty { display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; min-height: 80px; padding: 12px 0; margin: 0; color: #b39cb3; }
.call-caption-flower { color: #d5b1d77a; font-size: 26px; line-height: 1; }
.call-caption-hidden { border: 1px dashed #d3aed022; border-radius: 18px; background: #ffffff03; padding: 15px; text-align: center; line-height: 1.8; }
.call-bottom { position: relative; }
.call-control > span { border-color: #d7b4d82a; background: #d5b1d506; }
.call-control.selected > span { background: linear-gradient(145deg,#edb5d124,#bfa4df16); border-color: #e3b9dd4d; box-shadow: inset 0 1px #fff1ff0b; }
.call-main-button.dial { border: 1px solid #ffe4f154; background: linear-gradient(110deg,#edc2d9,#d6c4ee 72%,#c5d5eb); box-shadow: 0 8px 30px #d4acce19,inset 0 1px #fff5ff55; }
.call-footnote { line-height: 1.7; }
@media(max-height:720px) {
  .call-person { padding-top: 40px; }
  .call-avatar-wrap { margin-bottom: 31px; }
  .call-caption-stage { margin-top: 25px; min-height: 125px; }
  .call-caption-mascot { width: 94px; top: -48px; }
}
@media(max-height:620px) {
  .call-person { padding-top: 25px; }
  .call-avatar-wrap { margin-bottom: 23px; }
  .call-person h1 { font-size: 24px; }
  .call-person-note { font-size: 10px; letter-spacing: 1px; }
  .call-status { margin-top: 10px; }
  .call-caption-stage { margin-top: 21px; min-height: 102px; }
  .call-caption-mascot { width: 77px; top: -39px; right: 10px; }
  .call-caption-heading { padding-top: 12px; }
  .call-caption-empty { gap: 5px; min-height: 0; padding: 4px 0; font-size: 10px; }
  .call-caption-flower { font-size: 21px; }
  .call-bottom { padding-top: 11px; }
  .call-secondary-controls { margin-bottom: 8px; }
  .call-wave { height: 16px; }
}
</style>
