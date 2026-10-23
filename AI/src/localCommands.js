import { isDesktopRuntime } from './runtime.js'

const SOURCE_LABELS = Object.freeze({
  manual: '手动添加',
  start_menu: '开始菜单',
  registry: '已安装软件',
  system: 'Windows 系统',
  path: '系统 PATH'
})

function normalizeTarget(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[。！!？?]+$/g, '')
    .replace(/\s+/g, ' ')
}

/** Return null for an ordinary chat message, otherwise a local open command. */
export function parseOpenApplicationCommand(input) {
  const text = String(input || '').trim()
  if (!text) return null

  let target = ''
  const slashMatch = text.match(/^\/打开\s+(.+)$/i)
  if (slashMatch) {
    target = slashMatch[1]
  } else {
    const naturalMatch = text.match(
      /^(?:请|麻烦)?\s*(?:帮我)?\s*打开(?:一下)?\s*(.+?)(?:软件|应用|程序)?[。！!？?]*$/i
    )
    if (!naturalMatch) return null
    target = naturalMatch[1]
  }

  return { type: 'open_application', target: normalizeTarget(target) }
}

export async function openLocalApplication(applicationId) {
  if (!isDesktopRuntime()) throw new Error('打开本地软件仅支持桌面客户端')
  return globalThis.xilianDesktop.invoke('open_application', { application: applicationId })
}

function normalizeApplication(application) {
  return {
    id: String(application.id || ''),
    label: String(application.name || '未知软件'),
    source: String(application.source || ''),
    sourceLabel: SOURCE_LABELS[application.source] || '本机软件目录',
    icon: '🖥️'
  }
}

export async function findLocalApplications(target) {
  if (!isDesktopRuntime()) throw new Error('搜索本地软件仅支持桌面客户端')
  const applications = await globalThis.xilianDesktop.invoke('search_applications', { query: target })
  return Array.isArray(applications) ? applications.map(normalizeApplication) : []
}

export async function chooseLocalApplicationFile(alias) {
  if (!isDesktopRuntime()) throw new Error('添加本地软件仅支持桌面客户端')
  const application = await globalThis.xilianDesktop.invoke('choose_application_file', { alias })
  return application ? normalizeApplication(application) : null
}
