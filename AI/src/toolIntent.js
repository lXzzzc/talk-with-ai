const ALLOWED_TOOLS = new Set(['none', 'open_application', 'inspect_current_window'])
const MAX_TARGET_LENGTH = 100

export const NO_TOOL_INTENT = Object.freeze({
  tool: 'none',
  arguments: Object.freeze({}),
  title: '',
  description: '',
  requiresConfirmation: false
})

function safeText(value, maxLength) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

/**
 * Treat a planner response as untrusted input. Only known tools and the small,
 * human-readable argument schema are allowed through to the desktop UI.
 */
export function normalizeToolIntent(value) {
  if (!value || typeof value !== 'object' || !ALLOWED_TOOLS.has(value.tool)) {
    return NO_TOOL_INTENT
  }
  if (value.tool === 'none') return NO_TOOL_INTENT
  if (value.requiresConfirmation !== true) return NO_TOOL_INTENT

  if (value.tool === 'open_application') {
    const target = safeText(value.arguments?.target, MAX_TARGET_LENGTH)
    if (!target || /[\\/:;|&]/.test(target)) return NO_TOOL_INTENT
    return {
      tool: value.tool,
      arguments: { target },
      title: '打开本机应用',
      description: `确认后，昔涟会在本机应用目录中查找并启动“${target}”。`,
      requiresConfirmation: true
    }
  }

  return {
    tool: 'inspect_current_window',
    arguments: {},
    title: '查看当前窗口',
    description: '确认后，昔涟会截取当前前台窗口并上传截图给视觉模型分析。',
    requiresConfirmation: true
  }
}

export function fallbackToolIntent(openCommand, needsWindowCapture) {
  if (openCommand?.target) {
    return normalizeToolIntent({
      tool: 'open_application',
      arguments: { target: openCommand.target },
      requiresConfirmation: true
    })
  }
  if (needsWindowCapture) {
    return normalizeToolIntent({ tool: 'inspect_current_window', requiresConfirmation: true })
  }
  return NO_TOOL_INTENT
}
