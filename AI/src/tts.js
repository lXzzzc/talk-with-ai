// TTS 客户端封装 —— 调用后端 /api/ai/tts 接口。
// 后端把请求转发给本地部署的 IndexTTS（index-tts 项目的 WebUI），返回 WAV 音频。

/**
 * 调用后端合成语音。
 *
 * @param {string} text - 要朗读的文本。
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - 用于取消请求。
 * @returns {Promise<Blob>} 音频 Blob（本地 IndexTTS 输出 WAV）。
 */
export async function synthesize(text, options = {}) {
  const { signal } = options

  if (!text || !text.trim()) {
    return new Blob([], { type: 'audio/wav' })
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
    throw new Error('语音合成失败: ' + detail)
  }

  return res.blob()
}

/**
 * 合成并立即播放。
 *
 * @param {string} text
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<void>}
 */
export async function speak(text, options = {}) {
  const blob = await synthesize(text, options)
  if (blob.size === 0) return

  return playBlob(blob, options)
}

/** 播放已经合成好的音频，避免重复请求 TTS。 */
export function playBlob(blob, options = {}) {
  const { signal } = options

  const audioUrl = URL.createObjectURL(blob)
  const audio = new Audio(audioUrl)

  return new Promise((resolve, reject) => {
    const abort = () => {
      audio.pause()
      URL.revokeObjectURL(audioUrl)
      const error = new DOMException('Aborted', 'AbortError')
      reject(error)
    }
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    audio.onended = () => {
      signal?.removeEventListener('abort', abort)
      URL.revokeObjectURL(audioUrl)
      resolve()
    }
    audio.onerror = () => {
      signal?.removeEventListener('abort', abort)
      URL.revokeObjectURL(audioUrl)
      reject(new Error('Audio playback failed'))
    }
    audio.play().catch(reject)
  })
}
