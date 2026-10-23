import { createApp } from 'vue'
import App from './App.vue'
import DesktopPet from './DesktopPet.vue'
import PetChat from './PetChat.vue'
import SplashScreen from './SplashScreen.vue'
import VoiceCall from './VoiceCall.vue'
import './styles.css'
import './chatShell.css'

const view = new URLSearchParams(window.location.search).get('view')
const rootComponent = view === 'voice-call'
  ? VoiceCall
  : view === 'desktop-pet'
    ? DesktopPet
    : view === 'pet-chat'
      ? PetChat
      : view === 'splash'
        ? SplashScreen
        : App

createApp(rootComponent).mount('#app')
