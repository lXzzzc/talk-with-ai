import { createApp } from 'vue'
import App from './App.vue'
import VoiceCall from './VoiceCall.vue'
import './styles.css'

const voiceCallView = new URLSearchParams(window.location.search).get('view') === 'voice-call'
createApp(voiceCallView ? VoiceCall : App).mount('#app')
