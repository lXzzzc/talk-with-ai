// Edge TTS client - calls backend /api/ai/tts endpoint
// Backend handles the WebSocket connection to Microsoft Edge TTS

/**
 * Synthesize speech from text via backend Edge TTS proxy.
 *
 * @param {string} text - The text to synthesize.
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - AbortSignal to cancel the request.
 * @returns {Promise<Blob>} Audio blob (audio/mpeg).
 */
export async function synthesize(text, options = {}) {
  const { signal } = options

  if (!text || !text.trim()) {
    return new Blob([], { type: 'audio/mpeg' })
  }

  const url = '/api/ai/tts?text=' + encodeURIComponent(text)
  const res = await fetch(url, { signal })

  if (!res.ok) {
    throw new Error('Edge TTS request failed: HTTP ' + res.status)
  }

  return res.blob()
}

/**
 * Synthesize and play audio immediately.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<void>}
 */
export async function speak(text, options = {}) {
  const blob = await synthesize(text, options)
  if (blob.size === 0) return

  const audioUrl = URL.createObjectURL(blob)
  const audio = new Audio(audioUrl)

  return new Promise((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl)
      resolve()
    }
    audio.onerror = () => {
      URL.revokeObjectURL(audioUrl)
      reject(new Error('Audio playback failed'))
    }
    audio.play().catch(reject)
  })
}
