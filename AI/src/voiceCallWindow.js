import { isDesktopRuntime } from './runtime.js'

export const VOICE_CONTEXT_KEY = 'talk-ai-voice-context'
export const VOICE_CHANNEL = 'talk-ai-voice'

let popup = null

export async function openVoiceCallWindow(context) {
  localStorage.setItem(VOICE_CONTEXT_KEY, JSON.stringify(context))
  if (isDesktopRuntime()) {
    await globalThis.xilianDesktop.invoke('open_voice_call', { conversationId: context.conversationId })
    return
  }
  const url = new URL(window.location.href)
  url.search = new URLSearchParams({ view: 'voice-call', conversationId: context.conversationId }).toString()
  // 必须在用户点击事件内打开，避免异步准备后被浏览器当成广告弹窗拦截。
  if (popup && !popup.closed) { popup.focus(); return }
  popup = window.open(url.toString(), 'xilian-voice-call', 'popup=yes,width=345,height=595,resizable=yes,scrollbars=yes')
  if (!popup) throw new Error('通话窗口被浏览器拦截，请允许本网站弹出窗口后重试')
}
