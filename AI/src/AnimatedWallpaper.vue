<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { limitWallpaperResolution } from './wallpaperRendering.js'

const ROOT = '/wallpapers/xilian-workshop-3593357539/'
const emit = defineEmits(['ready'])
const host = ref(null)
const stage = ref(null)
const state = ref('loading')
const reducedMotion = ref(false)
const preview = `${ROOT}poster.png`
let player = null
let disposed = false
let preference = null
let renderingStopped = false

function loadRuntime() {
  if (globalThis.spine?.SpinePlayer) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `${ROOT}spine-player.css`
    document.head.append(css)
    const script = document.createElement('script')
    script.src = `${ROOT}spine-player.js`
    script.onload = resolve
    script.onerror = () => { script.remove(); reject(new Error('动态壁纸播放器加载失败')) }
    document.head.append(script)
  })
}

function updatePlayback() {
  reducedMotion.value = preference?.matches || false
  if (!player || state.value !== 'ready') return
  if (document.hidden || reducedMotion.value) {
    player.pause()
    if (!renderingStopped) player.stopRendering()
    renderingStopped = true
  } else {
    if (renderingStopped) player.startRendering()
    renderingStopped = false
    player.play()
  }
}

onMounted(async () => {
  preference = window.matchMedia('(prefers-reduced-motion: reduce)')
  preference.addEventListener('change', updatePlayback)
  document.addEventListener('visibilitychange', updatePlayback)
  updatePlayback()
  try {
    await loadRuntime()
    if (disposed) return
    let frames = 0
    player = new globalThis.spine.SpinePlayer(stage.value, {
      jsonUrl: `${ROOT}3.7kv.json`,
      atlasUrl: `${ROOT}3.7kv.atlas`,
      animation: 'animation',
      showControls: false,
      showLoading: false,
      alpha: true,
      backgroundColor: '00000000',
      premultipliedAlpha: false,
      // Preserve the framing supplied with the original Workshop wallpaper.
      viewport: { x: -900, y: -200, width: 1600, height: 600, debugRender: false },
      success: loaded => {
        if (disposed) return
        player = loaded
        limitWallpaperResolution(loaded)
      },
      error: (_loaded, message) => {
        if (disposed) return
        state.value = 'fallback'
        emit('ready')
        console.warn('[Wallpaper]', message)
      },
      draw: () => {
        // Keep the sharp poster until a real skeleton frame has been drawn.
        if (!disposed && state.value === 'loading') {
          state.value = 'ready'
          emit('ready')
          updatePlayback()
        }
        if (!disposed && ++frames % 15 === 0) host.value.dataset.frames = String(frames)
      }
    })
  } catch (error) {
    if (!disposed) { state.value = 'fallback'; emit('ready'); console.warn('[Wallpaper]', error) }
  }
})

onBeforeUnmount(() => {
  disposed = true
  document.removeEventListener('visibilitychange', updatePlayback)
  preference?.removeEventListener('change', updatePlayback)
  player?.dispose()
})
</script>

<template>
  <div ref="host" class="animated-wallpaper" :data-state="state" aria-hidden="true">
    <img v-if="state !== 'ready'" class="wallpaper-preview" :src="preview" alt="" draggable="false" fetchpriority="high" />
    <div ref="stage" class="wallpaper-spine" :class="{ 'is-ready': state === 'ready' }"></div>
    <div class="wallpaper-shade"></div>
  </div>
</template>

<style scoped>
.animated-wallpaper { position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; background: #c8c4e6; }
.wallpaper-preview { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.wallpaper-spine { position: absolute; top: 50%; left: 50%; width: max(100vw, 177.778vh); height: max(100vh, 56.25vw); transform: translate(-50%, -50%); opacity: 0; }
.wallpaper-spine.is-ready { opacity: 1; }
.wallpaper-spine :deep(.spine-player) { width: 100%; height: 100%; }
.wallpaper-shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(12, 6, 23, .48), rgba(12, 6, 23, .32) 55%, rgba(12, 6, 23, .12)); }
:root[data-theme="light"] .wallpaper-shade { background: linear-gradient(90deg, rgba(253, 247, 255, .48), rgba(253, 247, 255, .26) 55%, rgba(253, 247, 255, .08)); }
</style>
