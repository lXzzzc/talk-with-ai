<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({ busy: Boolean })
const emit = defineEmits(['cancel'])
const dialog = ref(null)
let previousFocus
function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (!props.busy) emit('cancel')
  }
  if (event.key !== 'Tab') return
  const controls = [...dialog.value.querySelectorAll('button:not(:disabled), select:not(:disabled)')]
  if (!controls.length) { event.preventDefault(); return }
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
onMounted(() => {
  previousFocus = document.activeElement
  dialog.value.querySelector('.command-cancel')?.focus()
})
onBeforeUnmount(() => { if (previousFocus?.isConnected) previousFocus.focus?.() })
</script>

<template>
  <section ref="dialog" class="command-dialog xilian-command-dialog" role="dialog" aria-modal="true"
    :aria-busy="busy" @keydown="onKeydown">
    <div class="xilian-dialog-perch" aria-hidden="true">
      <span class="xilian-perch-glow"></span>
      <span class="xilian-perch-spark spark-left">✧</span>
      <span class="xilian-perch-spark spark-right">✦</span>
      <img src="/xilian-dialog-perch-v1.png" alt="" draggable="false" />
    </div>
    <div class="xilian-dialog-inlay" aria-hidden="true">
      <svg class="xilian-corner-vine" viewBox="0 0 100 120" fill="none">
        <path d="M94 111C47 104 15 67 17 12M30 76C9 79 2 66 5 53C20 55 30 62 30 76ZM20 48C1 41 2 28 8 20C22 28 25 39 20 48ZM49 97C30 106 15 98 13 86C29 82 42 85 49 97ZM72 108C67 85 77 77 89 77C92 91 88 101 72 108Z" stroke="currentColor" stroke-width="1.1" />
        <path d="M26 61C47 56 50 43 45 34C30 38 24 48 26 61ZM45 88C65 80 66 67 60 59C45 65 41 76 45 88Z" stroke="currentColor" stroke-width="1.1" />
      </svg>
      <span class="xilian-water-ring ring-one"></span><span class="xilian-water-ring ring-two"></span>
    </div>
    <div class="xilian-dialog-kicker"><span></span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3C17 7 19 8 12 12C5 8 7 7 12 3ZM21 12C17 17 16 19 12 12C16 5 17 7 21 12ZM12 21C7 17 5 16 12 12C19 16 17 17 12 21ZM3 12C7 7 8 5 12 12C8 19 7 17 3 12Z" stroke="currentColor" stroke-width=".8" /></svg>昔涟陪你，轻轻确认<span></span></div>
    <slot />
    <div class="xilian-dialog-signature" aria-hidden="true"><span>✧</span> 每一步，都由你决定 <span>✧</span></div>
  </section>
</template>

<style>
.command-overlay:has(.xilian-command-dialog) { padding:145px 22px 30px; overflow-y:auto; background:radial-gradient(ellipse at 50% 36%,#8f719e21,transparent 60%),#10091e9c; }
.xilian-command-dialog { position:relative; isolation:isolate; width:min(100%,460px); gap:17px 14px; padding:28px 27px 16px; border-radius:26px; border:1px solid #bda0d95c; background:radial-gradient(ellipse at 50% 0,#9567a422,transparent 65%),linear-gradient(145deg,#2b203bee,#20172ff5); box-shadow:0 26px 85px #13091d66,0 0 45px #c397d00b,inset 0 1px #fff3ff12; }
.xilian-command-dialog::before { content:""; position:absolute; inset:6px; border:1px solid #d3bbeb13; border-radius:21px; pointer-events:none; z-index:-1; }
.xilian-dialog-perch { position:absolute; z-index:2; pointer-events:none; width:228px; height:149px; left:50%; top:-132px; transform:translateX(-50%); }
.xilian-dialog-perch img { position:relative; display:block; width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 8px 13px #11071a2b); }
.xilian-perch-glow { position:absolute; inset:28px -34px 12px; border-radius:50%; background:radial-gradient(ellipse,#d3aeed20,transparent 70%); }
.xilian-perch-spark { position:absolute; color:#e5c8f1bb; font-size:17px; text-shadow:0 0 12px #e7b7f044; }.spark-left{left:-24px;top:69px;transform:rotate(-14deg)}.spark-right{right:-20px;top:41px;font-size:12px}
.xilian-dialog-inlay { position:absolute; z-index:-1; pointer-events:none; inset:0; overflow:hidden; border-radius:inherit; }
.xilian-corner-vine { position:absolute; width:92px; height:110px; right:-4px; bottom:38px; transform:scaleX(-1); color:#cbb0e42e; }
.xilian-water-ring { position:absolute; left:-42px; bottom:-52px; width:210px; height:110px; border:1px solid #b7cced18; border-radius:50%; transform:rotate(-15deg); }.xilian-water-ring.ring-two{left:-26px;bottom:-63px;width:240px;height:137px;border-color:#dbadd71c;}
.xilian-dialog-kicker { display:flex; align-items:center; justify-content:center; grid-column:1/-1; gap:9px; margin:0 0 2px; color:#c3a8d6; font-size:10px; letter-spacing:1.6px; }
.xilian-dialog-kicker>span { width:27px; height:1px; background:linear-gradient(90deg,transparent,#c1a1d466); }.xilian-dialog-kicker>span:last-child{transform:scaleX(-1)}
.xilian-dialog-kicker svg { width:14px; height:14px; margin-right:-3px; }
.xilian-command-dialog .command-app-icon { width:46px; height:46px; border:1px solid #d4b5ec21; background:linear-gradient(145deg,#b095c82e,#a9c9ee15); border-radius:16px; font-size:23px; }
.xilian-command-dialog .command-tool-label { margin-bottom:5px; color:#c5a4d2; font-size:10px; font-weight:500; letter-spacing:1.2px; text-transform:none; }
.xilian-command-dialog .command-copy h2 { margin:0 0 8px; font-size:20px; font-weight:600; letter-spacing:.3px; overflow-wrap:anywhere; }
.xilian-command-dialog .command-copy p { color:#b8a7c7; font-size:12px; line-height:1.85; overflow-wrap:anywhere; }
.xilian-command-dialog .command-impact { gap:5px; padding:13px 15px; border:1px solid #c5a7dd29; border-radius:14px; background:linear-gradient(115deg,#c29bdc0b,#ecbfd808); color:#baa6c9; font-size:12px; line-height:1.8; }
.xilian-command-dialog .command-impact strong { color:#dfcde9; font-size:11px; font-weight:500; letter-spacing:1px; }
.xilian-command-dialog .command-actions { gap:9px; margin-top:0; flex-wrap:wrap; }
.xilian-command-dialog .command-actions button { min-width:86px; height:39px; padding:0 16px; border-radius:13px; font-size:12px; }
.xilian-command-dialog .command-confirm { border:1px solid #edc8f63d; background:linear-gradient(115deg,#8f5fa3,#9d5b8f); box-shadow:0 6px 19px #b083c026,inset 0 1px #ffffff24; }
.xilian-command-dialog .command-browse { border-color:#ceb2e33d; background:#c9a2e00d; color:#d9c3e5; }.xilian-command-dialog .command-cancel{border-color:#c5b0db24;background:#ffffff05;color:#c6b6d2;}
.xilian-dialog-signature { display:flex; grid-column:1/-1; align-items:center; justify-content:center; gap:9px; margin-top:-3px; font-size:9px; letter-spacing:1.1px; color:#ad94bc; }.xilian-dialog-signature span{font-size:12px;color:#b598ca80;}
.xilian-command-dialog button:focus-visible { outline:2px solid #bc94d1; outline-offset:3px; }
:root[data-theme="light"] .xilian-command-dialog { border-color:#dac6e8; background:radial-gradient(ellipse at 50% 0,#f1dff6b3,transparent 60%),linear-gradient(145deg,#fffafff7,#f5effbf7); box-shadow:0 26px 85px #2e194633,0 0 45px #dcc6e51a,inset 0 1px #fff; }
:root[data-theme="light"] .xilian-command-dialog::before { border-color:#c5a5d421; }
:root[data-theme="light"] .xilian-dialog-kicker { color:#9778ab; }
:root[data-theme="light"] .xilian-command-dialog .command-app-icon { border-color:#c4a1d52b; background:linear-gradient(145deg,#eadcf4,#e7e9f8); }
:root[data-theme="light"] .xilian-command-dialog .command-tool-label { color:#a17dae; }
:root[data-theme="light"] .xilian-command-dialog .command-copy p { color:#786384; }
:root[data-theme="light"] .xilian-command-dialog .command-impact { border-color:#d9c4e559; background:linear-gradient(115deg,#edddf34d,#f7eafa5c); color:#786384; }
:root[data-theme="light"] .xilian-command-dialog .command-impact strong { color:#715383; }
:root[data-theme="light"] .xilian-command-dialog .command-confirm { background:linear-gradient(115deg,#8f5fa3,#9d5b8f); box-shadow:0 6px 19px #b083c02b,inset 0 1px #ffffff45; }
:root[data-theme="light"] .xilian-command-dialog .command-browse { border-color:#d5bbdf; background:#f3eafa8c; color:#80618f; }
:root[data-theme="light"] .xilian-command-dialog .command-cancel { border-color:#e5d8ee; background:#fffaffb3; color:#8a7297; }
:root[data-theme="light"] .xilian-dialog-signature { color:#a78db4; }
:root[data-theme="light"] .xilian-corner-vine { color:#ae8ec137; }
:root[data-theme="light"] .xilian-water-ring { border-color:#aabfe53d; }:root[data-theme="light"] .xilian-water-ring.ring-two{border-color:#ceacd63d;}
@media(max-width:480px) { .command-overlay:has(.xilian-command-dialog){padding:132px 14px 24px}.xilian-command-dialog{padding:25px 20px 15px;gap:15px 11px}.xilian-dialog-perch{width:210px;height:137px;top:-121px}.xilian-command-dialog .command-actions{justify-content:stretch}.xilian-command-dialog .command-actions button{flex:1;min-width:74px;padding:0 9px}.xilian-dialog-kicker{font-size:9px;letter-spacing:.8px}.xilian-command-dialog .command-copy h2{font-size:18px} }
@media(max-height:620px) { .command-overlay:has(.xilian-command-dialog){align-items:start;padding-top:137px}.xilian-command-dialog{margin-bottom:12px} }
</style>
