import { apiUrl } from './api.js'
import { httpFetch } from './http.js'

const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg'
]

export function selectSupportedAudioMimeType(isSupported) {
  return AUDIO_MIME_CANDIDATES.find((type) => isSupported(type)) || ''
}

export function isVoiceInputSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder)
}

export async function startVoiceRecording() {
  if (!isVoiceInputSupported()) {
    throw new Error('当前环境不支持麦克风录音')
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: false
  })

  const mimeType = selectSupportedAudioMimeType((type) => MediaRecorder.isTypeSupported(type))
  let recorder
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    throw error
  }

  const chunks = []
  let cancelled = false
  let settled = false
  let resolveStopped
  let rejectStopped
  const stopped = new Promise((resolve, reject) => {
    resolveStopped = resolve
    rejectStopped = reject
  })

  const closeTracks = () => stream.getTracks().forEach((track) => track.stop())

  recorder.ondataavailable = (event) => {
    if (!cancelled && event.data?.size) chunks.push(event.data)
  }
  recorder.onerror = (event) => {
    if (settled) return
    settled = true
    closeTracks()
    rejectStopped(event.error || new Error('录音失败'))
  }
  recorder.onstop = () => {
    if (settled) return
    settled = true
    closeTracks()
    const outputType = recorder.mimeType || mimeType || chunks[0]?.type || 'audio/webm'
    resolveStopped(new Blob(cancelled ? [] : chunks, { type: outputType }))
  }
  recorder.start(250)

  return {
    stop() {
      if (recorder.state !== 'inactive') recorder.stop()
      return stopped
    },
    cancel() {
      cancelled = true
      if (recorder.state !== 'inactive') recorder.stop()
      return stopped
    }
  }
}

export async function transcribeAudio(audio, { signal } = {}) {
  if (!audio?.size) throw new Error('没有录到可识别的声音')

  const form = new FormData()
  const extension = audio.type.includes('ogg') ? 'ogg' : 'webm'
  form.append('audio', audio, `voice-input.${extension}`)

  const response = await httpFetch(apiUrl('/api/ai/asr'), {
    method: 'POST',
    body: form,
    signal
  })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const data = await response.json()
      detail = data?.message || detail
    } catch {
      // 保留 HTTP 状态码。
    }
    throw new Error(detail)
  }
  return await response.json()
}
