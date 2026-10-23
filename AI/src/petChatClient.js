import { apiUrl } from './api.js'
import { httpFetch } from './http.js'

// Same chat endpoint and anonymous user as the full client. Bubble replies are
// plain text: model output is never interpreted as HTML or a desktop command.
export async function streamPetReply({ userId, conversationId, prompt, signal, onText }) {
  const response = await httpFetch(apiUrl('/api/ai/chat'), {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/html;charset=utf-8' },
    body: JSON.stringify({ userId, conversationId, prompt,
      weatherLocation: localStorage.getItem('spring-ai-test-weather-location') || null })
  })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try { detail = (await response.json()).message || detail } catch { /* use HTTP status */ }
    throw new Error(detail)
  }
  if (!response.body) {
    const text = await response.text(); onText(text); return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      onText(text)
    }
    text += decoder.decode()
    onText(text)
    return text
  } finally { reader.releaseLock() }
}
