import { invoke } from '@tauri-apps/api/core'
import { apiUrl } from './api.js'
import { httpFetch } from './http.js'
import { isDesktopRuntime } from './runtime.js'

export async function captureCurrentWindow() {
  if (!isDesktopRuntime()) {
    throw new Error('当前窗口截图仅支持昔涟 AI 桌面客户端')
  }
  return await invoke('capture_active_window')
}

export function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''))
  if (!match) throw new Error('截图数据格式无效')

  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: match[1] })
}

export async function analyzeWindowCapture({
  capture,
  question,
  userId,
  conversationId,
  signal
}) {
  const form = new FormData()
  const image = dataUrlToBlob(capture.imageData)
  form.append('image', image, 'current-window.jpg')
  form.append('userId', userId)
  form.append('conversationId', conversationId)
  form.append('question', question || '')
  form.append('windowTitle', capture.title || '')

  const response = await httpFetch(apiUrl('/api/ai/vision'), {
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
      // 非 JSON 代理错误页，保留状态码。
    }
    throw new Error(detail)
  }
  return await response.json()
}
