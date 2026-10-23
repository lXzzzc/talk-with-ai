import { createApp } from 'vue'
import App from './App.vue'
import DesktopPet from './DesktopPet.vue'
import VoiceCall from './VoiceCall.vue'
import './styles.css'

const view = new URLSearchParams(window.location.search).get('view')
const rootComponent = view === 'voice-call'
  ? VoiceCall
  : view === 'desktop-pet'
    ? DesktopPet
    : App

createApp(rootComponent).mount('#app')
