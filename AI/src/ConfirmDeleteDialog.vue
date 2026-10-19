<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({ title: { type: String, required: true }, busy: Boolean, error: String })
const emit = defineEmits(['confirm', 'cancel'])
const dialog = ref(null)
const cancel = ref(null)
let previousFocus = null

function close() { if (!props.busy) emit('cancel') }
function onKeydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  if (event.key !== 'Tab') return
  const buttons = [...dialog.value.querySelectorAll('button:not(:disabled)')]
  if (!buttons.length) { event.preventDefault(); return }
  const first = buttons[0]
  const last = buttons[buttons.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

onMounted(() => { previousFocus = document.activeElement; cancel.value?.focus() })
onBeforeUnmount(() => previousFocus?.focus?.())
</script>

<template>
  <div class="command-overlay" @click.self="close" @keydown="onKeydown">
    <section ref="dialog" class="command-dialog delete-dialog" role="alertdialog" aria-modal="true"
      aria-labelledby="delete-conversation-title" aria-describedby="delete-conversation-description" :aria-busy="busy">
      <div class="command-copy">
        <h2 id="delete-conversation-title">删除这个对话？</h2>
        <p id="delete-conversation-description">「{{ title }}」的聊天记录会被删除，此操作无法撤销。</p>
        <p v-if="error" class="delete-dialog-error" role="alert">{{ error }}</p>
      </div>
      <div class="command-actions">
        <button ref="cancel" type="button" class="command-cancel" :disabled="busy" @click="close">取消</button>
        <button type="button" class="command-confirm delete-confirm" :disabled="busy" @click="emit('confirm')">
          {{ busy ? '正在删除…' : '确认删除' }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.delete-dialog { max-width: 410px; }
.delete-dialog p { overflow-wrap: anywhere; }
.delete-confirm { background: #be5267; color: #fff; }
.delete-dialog-error { color: #e98f9d; }
</style>
