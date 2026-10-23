<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import VideoPetStage from './VideoPetStage.vue'
const leaving = ref(false)
const disabled = ref(false)
const reduced = ref(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
let timer
let exitTimer
let finished = false
function finish() {
  if (finished) return
  finished = true
  clearTimeout(timer)
  leaving.value = true
  exitTimer = setTimeout(() => globalThis.xilianDesktop?.invoke('splash_finish', { disable: disabled.value }), reduced.value ? 0 : 180)
}
onMounted(() => { timer = setTimeout(finish, reduced.value ? 250 : 2700) })
onBeforeUnmount(() => { clearTimeout(timer); clearTimeout(exitTimer) })
</script>

<template>
  <main class="welcome-screen" :class="{ leaving, 'reduce-motion': reduced }" @keydown.esc="finish">
    <img class="welcome-wallpaper" src="/wallpapers/xilian-workshop-3593357539/poster.png" alt="" />
    <div class="welcome-wash"></div>
    <div class="welcome-grain"></div>
    <span class="welcome-star star-one">✧</span><span class="welcome-star star-two">✦</span><span class="welcome-star star-three">✧</span>
    <div class="welcome-portrait">
      <div class="welcome-ripples"><i></i><i></i><i></i></div>
      <VideoPetStage initial-action="greeting" :ambient="false" />
    </div>
    <section class="welcome-copy"><span class="welcome-eyebrow">A LITTLE MOMENT, WITH YOU</span>
      <h1>昔涟<span>AI</span></h1><div class="welcome-line"></div>
      <p class="welcome-greeting">你来了。</p><p class="welcome-note">让每一个平凡的片刻，<br>都有温柔相伴。</p>
      <div class="welcome-loading" aria-label="正在准备主界面"><i></i><i></i><i></i><span>正在赴约</span></div>
    </section>
    <footer class="welcome-footer"><label><input v-model="disabled" type="checkbox" />下次直接进入</label>
      <button type="button" @click="finish">跳过 <span>→</span></button></footer>
  </main>
</template>

<style>
html.splash-view, html.splash-view body, html.splash-view #app { width:100%; height:100%; min-width:0; min-height:0; overflow:hidden; background:transparent!important; }
.welcome-screen { position:relative; width:100vw; height:100vh; overflow:hidden; box-sizing:border-box; border:1px solid #ffffffa6; border-radius:24px; background:#eae1f6; color:#65506f; font-family:'Microsoft YaHei','Segoe UI',sans-serif; opacity:1; transition:opacity 180ms ease; }
.welcome-screen.leaving { opacity:0; }
.welcome-wallpaper { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:65% center; opacity:.36; }
.welcome-wash { position:absolute; inset:0; background:linear-gradient(100deg,#f4eaf8d9,#f4eaf8c9 40%,#eee5f1df); }
.welcome-grain { position:absolute; inset:0; background:radial-gradient(ellipse at 25% 70%,#ffffffac,transparent 57%); }
.welcome-portrait { position:absolute; left:24px; bottom:49px; width:350px; height:350px; animation:welcome-arrive 1s .25s both; }
.welcome-portrait>.video-pet-stage { z-index:1; filter:drop-shadow(0 15px 18px #9c73b322); }
.welcome-ripples { position:absolute; left:50%; bottom:8px; width:220px; height:60px; transform:translateX(-50%); }
.welcome-ripples i { position:absolute; inset:0; border:1px solid #c09ed080; border-radius:50%; animation:welcome-ripple 2.6s ease-out both; }
.welcome-ripples i:nth-child(2) { animation-delay:.35s; }.welcome-ripples i:nth-child(3) { animation-delay:.7s; }
.welcome-copy { position:absolute; left:405px; top:102px; animation:welcome-arrive .9s .45s both; }
.welcome-eyebrow { font-size:8px; letter-spacing:2.5px; color:#a18bac; }
.welcome-copy h1 { margin:15px 0 17px; font-size:48px; font-weight:400; letter-spacing:12px; color:#70507f; }
.welcome-copy h1 span { font-size:13px; letter-spacing:2px; margin-left:5px; font-weight:300; color:#a58bad; }
.welcome-line { height:1px; width:120px; background:linear-gradient(90deg,#b69bc7,transparent); }
.welcome-greeting { font-size:21px; letter-spacing:3px; margin:22px 0 14px; }
.welcome-note { font-size:12px; letter-spacing:1.5px; line-height:2.1; color:#9b83a4; }
.welcome-loading { display:flex; align-items:center; gap:4px; margin-top:25px; color:#a88eb3; }
.welcome-loading i { width:3px; height:3px; border-radius:50%; background:#b596c3; animation:welcome-dot 1s infinite; }.welcome-loading i:nth-child(2){animation-delay:.15s}.welcome-loading i:nth-child(3){animation-delay:.3s}
.welcome-loading span { font-size:9px; letter-spacing:2px; margin-left:8px; }
.welcome-footer { position:absolute; bottom:23px; left:30px; right:30px; display:flex; align-items:center; justify-content:space-between; color:#ab94b3; font-size:10px; }
.welcome-footer label { display:flex; gap:5px; align-items:center; cursor:pointer; }.welcome-footer input { width:11px; height:11px; accent-color:#b08bc0; }
.welcome-footer button { border:0; background:#fff7ff63; border-radius:15px; padding:7px 12px; font:inherit; color:#9676a4; cursor:pointer; }.welcome-footer button span{margin-left:16px}
.welcome-star { position:absolute; color:#b397c8; animation:welcome-twinkle 2.8s both; }.star-one{left:65px;top:88px;font-size:24px}.star-two{left:350px;top:72px;font-size:11px;animation-delay:.3s}.star-three{left:322px;bottom:98px;font-size:18px;animation-delay:.6s}
@keyframes welcome-arrive { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
@keyframes welcome-ripple { 0% { opacity:0; transform:scale(.3); } 25%{opacity:.8} 100%{opacity:0; transform:scale(1.6);} }
@keyframes welcome-dot { 50%{opacity:.25;transform:translateY(-2px)} }
@keyframes welcome-twinkle { 0%,100%{opacity:0} 40%,65%{opacity:.8} }
.reduce-motion *, .reduce-motion { animation:none!important; transition:none!important; }
.welcome-screen { color-scheme:light; }
</style>
