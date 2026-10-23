<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  CORE_URL,
  FALLBACK_IMAGE,
  HIT_ACTIONS,
  LIVE2D_ENABLED,
  MODEL_URL,
  MOUTH_PARAM,
  MOTIONS
} from './live2dConfig'
import { createRuntimeRig } from './runtimeRig'

const props = defineProps({
  modelUrl: { type: String, default: MODEL_URL },
  coreUrl: { type: String, default: CORE_URL },
  mouth: { type: Number, default: 0 },
  mood: { type: String, default: '' },
  followPointer: { type: Boolean, default: true },
  interactive: { type: Boolean, default: true },
  paused: { type: Boolean, default: false },
  fit: { type: String, default: 'contain' },
  fallback: { type: String, default: FALLBACK_IMAGE },
  enabled: { type: Boolean, default: LIVE2D_ENABLED }
})

const emit = defineEmits(['ready', 'error', 'hit'])

const host = ref(null)
const failed = ref(false)
const loading = ref(true)

let app = null
let model = null
let observer = null
let disposed = false
let pointerHandler = null
let leaveHandler = null
let visibilityHandler = null
let runtimeRig = null
const hitLocks = new Map()

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-live2d-core="${src}"]`)
    if (existing) {
      if (globalThis.Live2DCubismCore) resolve()
      else existing.addEventListener('load', resolve, { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.dataset.live2dCore = src
    script.onload = resolve
    script.onerror = () => reject(new Error(`无法加载 Live2D Core: ${src}`))
    document.head.appendChild(script)
  })
}

async function ensureCore() {
  if (globalThis.Live2DCubismCore) return
  await loadScript(props.coreUrl)
  if (!globalThis.Live2DCubismCore) throw new Error('Live2D Core 未初始化')
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function setMouth(value) {
  const level = clamp01(value)
  runtimeRig?.setMouth(level)
  const core = model?.internalModel?.coreModel
  const ids = core?._model?.parameters?.ids
  const index = Array.isArray(ids) ? ids.indexOf(MOUTH_PARAM) : -1
  if (index >= 0 && core?.setParameterValueByIndex) core.setParameterValueByIndex(index, level)
}

function resize() {
  if (!app || !model || !host.value) return
  const width = host.value.clientWidth || 1
  const height = host.value.clientHeight || 1
  const inner = model.internalModel
  // originalWidth/Height are the 1195x1316 canvas; internalModel.width/height
  // can be the 2x2 logical layout and would produce a 100x+ scale.
  const modelWidth = inner?.originalWidth || inner?.width || 1
  const modelHeight = inner?.originalHeight || inner?.height || 1
  const scale = props.fit === 'cover'
    ? Math.max(width / modelWidth, height / modelHeight)
    : Math.min(width / modelWidth, height / modelHeight)
  model.scale.set(scale)
  model.position.set(width / 2, height / 2)
  model.anchor.set(0.5, 0.5)
  globalThis.__live2dDebug = {
    host: { width, height },
    model: { width: modelWidth, height: modelHeight, scale },
    bounds: model.getLocalBounds?.()
  }
  console.log('[Live2D] resize', globalThis.__live2dDebug)
}

function onHit(areas) {
  const hit = Array.isArray(areas) ? areas[0] : areas
  const action = HIT_ACTIONS[hit]
  if (!action) return
  const now = Date.now()
  if (now - (hitLocks.get(hit) || 0) < action.cooldownMs) return
  hitLocks.set(hit, now)
  emit('hit', hit)
  if (action.motion) playMotion(action.motion, 0)
  if (action.expression) model?.expression(action.expression)
  if (action.resetExpression) {
    window.setTimeout(() => {
      if (!disposed) model?.expression(action.resetExpression)
    }, action.cooldownMs)
  }
}

function onPointerMove(event) {
  if (!props.followPointer || !model || !host.value) return
  const rect = host.value.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  const y = ((event.clientY - rect.top) / rect.height) * 2 - 1
  runtimeRig?.setFocus(x, -y)
  if (typeof model.focus === 'function') model.focus(x, -y)
  else model.internalModel?.focusController?.focus(x, -y)
}

function onPointerLeave() {
  runtimeRig?.setFocus(0, 0)
  if (typeof model?.focus === 'function') model.focus(0, 0)
  else model?.internalModel?.focusController?.focus(0, 0)
}

function fail(error) {
  if (disposed) return
  globalThis.__live2dError = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : ''
  }
  failed.value = true
  loading.value = false
  emit('error', error)
}

async function start() {
  if (!props.enabled) {
    loading.value = false
    failed.value = true
    return
  }
  try {
    await ensureCore()

    // Load Pixi and the engine only after Core is available; this keeps the
    // rest of the app buildable even when the model is not exported yet.
    const PIXI = await import('pixi.js')
    // Use the Cubism 3/4/5 entry only. The root entry also wires the legacy
    // Cubism 2 runtime and throws when live2d.min.js is not present.
    const { Live2DModel, Live2DPlugin } = await import('untitled-pixi-live2d-engine/cubism')
    PIXI.extensions.add(Live2DPlugin)

    app = new PIXI.Application()
    await app.init({
      resizeTo: host.value,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: 'webgl',
      // Keep the last frame for Electron's transparent-window compositor and
      // for screenshot/QA capture; without it the buffer can be cleared.
      preserveDrawingBuffer: true
    })
    host.value.appendChild(app.canvas)

    model = await Live2DModel.from(props.modelUrl, {
      autoInteract: props.interactive,
      motionPreload: 'IDLE'
    })
    model.anchor.set(0.5, 0.5)
    app.stage.addChild(model)
    runtimeRig = createRuntimeRig(model.internalModel)
    runtimeRig.setMouth(props.mouth)
    globalThis.__live2dModel = model
    globalThis.__live2dApp = app
    resize()
    // Some Pixi 8 builds defer the first ticker frame until after layout,
    // and a hidden/headless page can stop it; start it and draw one frame.
    app.ticker.start()
    app.render()

    observer = new ResizeObserver(resize)
    observer.observe(host.value)

    if (props.mood) model.expression(props.mood)
    if (props.interactive) model.on('hit', onHit)

    app.ticker.add(() => setMouth(props.mouth), undefined, PIXI.UPDATE_PRIORITY.LOW)
    if (props.paused) app.ticker.stop()

    if (props.followPointer) {
      pointerHandler = onPointerMove
      leaveHandler = onPointerLeave
      host.value.addEventListener('pointermove', pointerHandler)
      host.value.addEventListener('pointerleave', leaveHandler)
    }

    visibilityHandler = () => {
      if (!app) return
      if (document.hidden || props.paused) app.ticker.stop()
      else app.ticker.start()
    }
    document.addEventListener('visibilitychange', visibilityHandler)

    loading.value = false
    emit('ready', model)
  } catch (error) {
    console.warn('[Live2D] load failed:', error)
    fail(error)
  }
}

function destroy() {
  disposed = true
  observer?.disconnect()
  observer = null
  if (pointerHandler && host.value) host.value.removeEventListener('pointermove', pointerHandler)
  if (leaveHandler && host.value) host.value.removeEventListener('pointerleave', leaveHandler)
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler)
  pointerHandler = null
  leaveHandler = null
  visibilityHandler = null
  runtimeRig?.destroy()
  runtimeRig = null
  try { model?.destroy() } catch { /* ignore */ }
  model = null
  try { app?.destroy(true, { children: true, texture: true }) } catch { /* ignore */ }
  app = null
}

function playMotion(group, index = 0) {
  runtimeRig?.play(group)
  const motions = model?.internalModel?.settings?.motions
  if (motions?.[group]?.length) model.motion(group, index)
}

function setExpression(name) {
  if (name) model?.expression(name)
}

function focus(x, y) {
  runtimeRig?.setFocus(x, y)
  if (typeof model?.focus === 'function') model.focus(x, y)
  else model?.internalModel?.focusController?.focus(x, y)
}

onMounted(start)

onBeforeUnmount(destroy)

watch(() => props.mouth, setMouth)

watch(() => props.mood, (name) => {
  if (!model) return
  if (name) model.expression(name)
})

watch(() => props.paused, (paused) => {
  if (!app) return
  if (paused) app.ticker.stop()
  else app.ticker.start()
})

defineExpose({ playMotion, setExpression, focus, model: () => model })
</script>

<template>
  <div ref="host" class="live2d-stage">
    <img v-if="failed" class="live2d-fallback" :src="fallback" alt="" draggable="false" />
    <div v-else-if="loading" class="live2d-loading" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
.live2d-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}
.live2d-stage :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
  background: transparent;
}
.live2d-fallback {
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
.live2d-loading {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 45%, rgba(255, 210, 240, 0.12), transparent 65%);
}
</style>
