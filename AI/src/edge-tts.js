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

  // POST + JSON：文本不再放进 URL，避免 URL 长度限制与访问日志留痕
  const res = await fetch('/api/ai/tts', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (data?.message) detail = data.message
    } catch {
      // 响应不是 JSON（例如代理返回的错误页），保留状态码即可
    }
    throw new Error('Edge TTS request failed: ' + detail)
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
