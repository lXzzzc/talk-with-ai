<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import VideoPetStage from './VideoPetStage.vue'

const stageRef = ref(null)
const actions = ref([])
const selectedAction = ref('')

async function desktopInvoke(command) {
  try {
    await globalThis.xilianDesktop?.invoke(command)
  } catch (error) {
    console.warn(`Desktop pet command failed: ${command}`, error)
  }
}

function playAction(action) {
  stageRef.value?.playAction(action)
  selectedAction.value = ''
}

onMounted(() => {
  document.body.classList.add('desktop-pet-body')
})

onBeforeUnmount(() => {
  document.body.classList.remove('desktop-pet-body')
})
</script>

<template>
  <main class="desktop-pet" aria-label="昔涟桌宠">
    <div class="pet-drag-surface" title="拖动昔涟">
      <div class="pet-motion">
        <VideoPetStage
          ref="stageRef"
          class="pet-character"
          @ready="actions = $event.actions"
        />
      </div>
    </div>

    <nav class="pet-controls" aria-label="桌宠操作">
      <button type="button" title="打开对话" @click="desktopInvoke('pet_open_chat')">对话</button>
      <button type="button" title="温柔回应" @click="playAction()">回应</button>
      <select v-model="selectedAction" aria-label="选择桌宠动作" @change="playAction(selectedAction)">
        <option value="" disabled>动作</option>
        <option v-for="action in actions" :key="action.id" :value="action.id">{{ action.label }}</option>
      </select>
      <button type="button" title="隐藏桌宠" @click="desktopInvoke('pet_hide')">隐藏</button>
    </nav>
  </main>
</template>

<style>
html.desktop-pet-view,
html.desktop-pet-view body,
html.desktop-pet-view #app,
body.desktop-pet-body {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: transparent !important;
}

.desktop-pet {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}

.pet-drag-surface {
  position: absolute;
  inset: 0 0 38px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  -webkit-app-region: drag;
}

.pet-motion {
  width: 334px;
  height: 334px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  transform-origin: 50% 92%;
  filter: drop-shadow(0 15px 12px rgba(48, 22, 82, 0.2));
}

.pet-character {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  pointer-events: none;
}

.pet-controls {
  position: absolute;
  left: 50%;
  bottom: 5px;
  z-index: 3;
  display: flex;
  gap: 4px;
  padding: 5px;
  border: 1px solid rgba(232, 207, 255, 0.48);
  border-radius: 999px;
  background: rgba(35, 20, 56, 0.78);
  box-shadow: 0 8px 24px rgba(41, 21, 72, 0.25);
  backdrop-filter: blur(12px);
  transform: translateX(-50%) translateY(8px);
  opacity: 0;
  transition: opacity 160ms ease, transform 160ms ease;
  -webkit-app-region: no-drag;
}

.desktop-pet:hover .pet-controls,
.pet-controls:focus-within {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.pet-controls button {
  min-width: 48px;
  padding: 6px 9px;
  border: 0;
  border-radius: 999px;
  color: #fff7ff;
  background: transparent;
  font: 600 12px/1.2 "Microsoft YaHei", "Segoe UI", sans-serif;
  cursor: pointer;
}

.pet-controls select {
  max-width: 100px;
  border: 0;
  border-radius: 12px;
  padding: 4px;
  color: #fff7ff;
  background: #35203f;
  cursor: pointer;
  font: 12px "Microsoft YaHei", sans-serif;
  -webkit-app-region: no-drag;
}

.pet-controls button:hover,
.pet-controls button:focus-visible {
  outline: none;
  background: linear-gradient(135deg, rgba(193, 111, 238, 0.92), rgba(238, 112, 190, 0.92));
}

</style>
