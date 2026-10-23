<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { subscribePetSpeech } from './petSpeech.js'
import { VIDEO_PET_ROOT as ROOT, pickPetAction, validatePetManifest } from './videoPetActions.js'

const props = defineProps({ interactive: { type: Boolean, default: false } })
const emit = defineEmits(['ready', 'error'])
const videos = []
const activeSlot = ref(-1)
const failed = ref(false)
const currentAction = ref('idle')
const blobUrls = new Map()
const controller = new AbortController()
let manifest = null
let revision = 0
let disposed = false
let speaking = false
let temporaryAction = false
let playbackMode = 'ambient'
let cancelPending = null
let unsubscribe = null
let motionPreference = null
let reducedMotion = false

async function assetUrl(action) {
  const file = manifest?.actions?.[action]?.file
  if (!file || !/^[\w-]+\.webm$/.test(file)) throw new Error(`桌宠动作缺失：${action}`)
  if (!blobUrls.has(file)) {
    const pending = fetch(`${ROOT}${file}`, { signal: controller.signal })
      .then(response => {
        if (!response.ok || !response.headers.get('content-type')?.includes('video/webm')) throw new Error(`无法读取桌宠动作：${action}`)
        return response.blob()
      })
      .then(blob => {
        if (disposed) throw new DOMException('Disposed', 'AbortError')
        return URL.createObjectURL(blob)
      })
      .catch(error => { blobUrls.delete(file); throw error })
    blobUrls.set(file, pending)
  }
  return blobUrls.get(file)
}

function waitForFrame(video) {
  return new Promise((resolve, reject) => {
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener('loadeddata', ready)
      video.removeEventListener('error', error)
      if (cancelPending === cancel) cancelPending = null
    }
    const ready = () => { cleanup(); resolve() }
    const error = () => { cleanup(); reject(new Error('桌宠视频解码失败')) }
    const cancel = () => { cleanup(); reject(new DOMException('Superseded', 'AbortError')) }
    cancelPending = cancel
    video.addEventListener('loadeddata', ready, { once: true })
    video.addEventListener('error', error, { once: true })
    timer = setTimeout(() => { cleanup(); reject(new Error('桌宠视频加载超时')) }, 10000)
    video.load()
  })
}

async function switchAction(action, force = false) {
  if (!manifest || disposed || reducedMotion) return
  if (!force && activeSlot.value >= 0 && currentAction.value === action) return
  const request = ++revision
  cancelPending?.()
  try {
    const url = await assetUrl(action)
    if (disposed || request !== revision) return
    const slot = activeSlot.value === 0 ? 1 : 0
    const next = videos[slot]
    next.pause()
    next.src = url
    next.loop = false
    await waitForFrame(next)
    if (disposed || request !== revision) return
    await next.play()
    if (disposed || request !== revision) return
    const previous = activeSlot.value
    // Cut between decoded frames; crossfading different poses doubles eyes/arms.
    activeSlot.value = slot
    currentAction.value = action
    failed.value = false
    if (previous >= 0) videos[previous]?.pause()
    emit('ready', { renderer: 'alpha-video', action,
      actions: Object.entries(manifest.actions).map(([id, item]) => ({ id, label: item.label })) })
  } catch (error) {
    if (disposed || request !== revision || error?.name === 'AbortError') return
    console.warn('[VideoPet]', error)
    temporaryAction = false
    emit('error', error)
    if (action !== 'idle') void switchAction('idle', true)
    else { failed.value = true; activeSlot.value = -1 }
  }
}

function playAction(action) {
  if (!manifest || speaking || reducedMotion) return
  temporaryAction = true
  playbackMode = 'tap'
  void switchAction(typeof action === 'string' && manifest.actions[action]
    ? action : pickPetAction(manifest, 'tap'), true)
}

function onEnded(slot) {
  if (slot !== activeSlot.value || !manifest) return
  temporaryAction = false
  playbackMode = speaking ? 'speech' : 'ambient'
  void switchAction(pickPetAction(manifest, playbackMode), true)
}

function onVideoError(slot) {
  if (slot !== activeSlot.value) return
  videos[slot]?.pause()
  activeSlot.value = -1
  failed.value = true
  emit('error', new Error('桌宠视频播放失败'))
}

function onSpeech(value) {
  if (speaking === value) return
  speaking = value
  if (speaking) temporaryAction = false
  if (!temporaryAction && manifest) {
    playbackMode = speaking ? 'speech' : 'ambient'
    void switchAction(speaking ? pickPetAction(manifest, 'speech') : 'idle', true)
  }
}

function onMotionPreference(event) {
  reducedMotion = event.matches
  revision++
  cancelPending?.()
  for (const video of videos) video?.pause()
  activeSlot.value = -1
  temporaryAction = false
  playbackMode = speaking ? 'speech' : 'ambient'
  if (!reducedMotion && manifest) void switchAction(speaking ? pickPetAction(manifest, 'speech') : 'idle', true)
}

onMounted(async () => {
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion = motionPreference.matches
  motionPreference.addEventListener('change', onMotionPreference)
  unsubscribe = subscribePetSpeech(onSpeech)
  try {
    const response = await fetch(`${ROOT}manifest.json`, { signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new Error('桌宠素材清单加载失败')
    manifest = validatePetManifest(await response.json())
    playbackMode = speaking ? 'speech' : 'ambient'
    await switchAction(speaking ? pickPetAction(manifest, 'speech') : 'idle')
    if (!disposed && !reducedMotion) {
      for (const entry of [...manifest.pools.tap, ...manifest.pools.speech]) {
        void assetUrl(entry.action).catch(() => {})
      }
    }
  } catch (error) {
    if (disposed) return
    failed.value = true
    emit('error', error)
  }
})

onBeforeUnmount(() => {
  disposed = true
  revision++
  cancelPending?.()
  controller.abort()
  unsubscribe?.()
  motionPreference?.removeEventListener('change', onMotionPreference)
  for (const video of videos) { video?.pause(); video?.removeAttribute('src'); video?.load() }
  for (const pending of blobUrls.values()) void pending.then(url => URL.revokeObjectURL(url)).catch(() => {})
  blobUrls.clear()
})

defineExpose({ playAction })
</script>

<template>
  <div class="video-pet-stage" :data-action="currentAction" :data-renderer="failed ? 'poster' : 'alpha-video'"
    :role="props.interactive ? 'button' : 'img'" :tabindex="props.interactive ? 0 : undefined"
    aria-label="昔涟" @click="props.interactive && playAction()"
    @keydown.enter="props.interactive && playAction()" @keydown.space.prevent="props.interactive && playAction()">
    <img v-show="activeSlot < 0" class="video-pet-poster" :src="`${ROOT}idle-poster.png`" alt="" draggable="false" />
    <video v-for="slot in 2" :key="slot" :ref="element => { videos[slot - 1] = element }"
      class="video-pet-layer" :class="{ 'is-active': activeSlot === slot - 1 }"
      muted playsinline preload="auto" disablepictureinpicture aria-hidden="true"
      @ended="onEnded(slot - 1)" @error="onVideoError(slot - 1)" />
  </div>
</template>

<style scoped>
.video-pet-stage { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: transparent; }
.video-pet-stage[role="button"] { cursor: pointer; }
.video-pet-stage:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.video-pet-layer, .video-pet-poster { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; background: transparent; }
.video-pet-layer { opacity: 0; }
.video-pet-layer.is-active { opacity: 1; }
</style>
