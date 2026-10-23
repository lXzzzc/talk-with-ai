const { app, BrowserWindow, Tray, Menu, dialog, desktopCapturer, ipcMain, nativeImage, screen, session, shell } = require('electron')
const http = require('node:http')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const { execFile, spawn } = require('node:child_process')
const httpProxy = require('http-proxy')
const { resolveApiPathMode, rewriteApiRequestUrl } = require('./proxy-routing.cjs')
const { startDesktopWindows, showDesktopWindows } = require('./desktop-startup.cjs')
const { bubblePosition, dragPosition } = require('./pet-geometry.cjs')

const API_ORIGIN = String(process.env.TALK_AI_DESKTOP_API_URL || 'http://101.35.54.118').trim().replace(/\/+$/, '')
const MAX_QUERY_CHARS = 100
const MAX_RESULTS = 8
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.moc3': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.webm': 'video/webm'
})

let mainWindow = null
let voiceWindow = null
let petWindow = null
let bubbleWindow = null
let splashWindow = null
let bubbleState = { mode: 'response', line: '嗯，我在。' }
let bubbleTimer = null
let dragState = null
let dragTimer = null
let startupPending = true
let mainPainted = false
let wallpaperReady = false
let splashFinished = false
let startupTimer = null
let bubbleReady = false
let bubbleWanted = false
let tray = null
let localServer = null
let localOrigin = ''
let quitting = false
let catalog = []

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    // Windows PowerShell 默认按控制台代码页输出，重定向到管道时中文会变成乱码；
    // 先切到 UTF-8，Node 侧再按 utf8 解码。
    const wrapped = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$OutputEncoding = [System.Text.Encoding]::UTF8\n${script}`
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrapped],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message).trim() || 'PowerShell 执行失败'))
          return
        }
        resolve(String(stdout || '').replace(/^\uFEFF/, '').trim())
      }
    )
  })
}

function stableId(value) {
  let hash = 0xcbf29ce484222325n
  for (const byte of Buffer.from(String(value).toLowerCase(), 'utf8')) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `app-${hash.toString(16).padStart(16, '0')}`
}

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function manualCatalogPath() {
  return path.join(app.getPath('userData'), 'applications-electron.json')
}

function readManualApplications() {
  try {
    const value = JSON.parse(fs.readFileSync(manualCatalogPath(), 'utf8'))
    return Array.isArray(value) ? value.filter(entry => entry.path && fs.existsSync(entry.path)) : []
  } catch {
    return []
  }
}

function writeManualApplications(entries) {
  fs.mkdirSync(path.dirname(manualCatalogPath()), { recursive: true })
  fs.writeFileSync(manualCatalogPath(), JSON.stringify(entries, null, 2), 'utf8')
}

async function refreshCatalog() {
  let startApps = []
  try {
    const output = await runPowerShell(
      "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress"
    )
    if (output) {
      const parsed = JSON.parse(output)
      startApps = (Array.isArray(parsed) ? parsed : [parsed])
        .filter(entry => entry?.Name && entry?.AppID)
        .map(entry => ({
          id: stableId(`start:${entry.AppID}`),
          name: String(entry.Name),
          aliases: [String(entry.Name)],
          source: 'start_menu',
          kind: 'start',
          target: String(entry.AppID)
        }))
    }
  } catch (error) {
    console.warn('Unable to read Start applications:', error.message)
  }

  const manualApps = readManualApplications().map(entry => ({
    id: stableId(`manual:${entry.path}`),
    name: entry.name,
    aliases: [entry.name, path.basename(entry.path, path.extname(entry.path))],
    source: 'manual',
    kind: 'manual',
    target: entry.path
  }))

  const merged = new Map()
  for (const entry of [...startApps, ...manualApps]) merged.set(entry.id, entry)
  catalog = [...merged.values()]
  return catalog
}

function matchScore(entry, query) {
  return entry.aliases.reduce((best, aliasValue) => {
    const alias = normalizeName(aliasValue)
    let score = 0
    if (alias === query) score = 10_000
    else if (alias.startsWith(query)) score = 8_000 - Math.max(0, alias.length - query.length)
    else if (alias.includes(query)) score = 6_000 - Math.max(0, alias.length - query.length)
    else if (query.length >= 2 && query.includes(alias)) score = 4_000 - Math.max(0, query.length - alias.length)
    return Math.max(best, score)
  }, 0)
}

async function searchApplications(queryValue) {
  const query = normalizeName(queryValue)
  if (!query) throw new Error('软件名称不能为空')
  if ([...String(queryValue)].length > MAX_QUERY_CHARS) throw new Error(`软件名称不能超过 ${MAX_QUERY_CHARS} 个字符`)
  if (!catalog.length) await refreshCatalog()

  const find = () => catalog
    .map(entry => ({ entry, score: matchScore(entry, query) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name, 'zh-CN'))
  let matches = find()
  if (!matches.length) {
    await refreshCatalog()
    matches = find()
  }
  if (matches[0]?.score === 10_000) matches = matches.filter(item => item.score === 10_000)
  return matches.slice(0, MAX_RESULTS).map(({ entry }) => ({ id: entry.id, name: entry.name, source: entry.source }))
}

async function openApplication(applicationId) {
  if (!catalog.length) await refreshCatalog()
  const entry = catalog.find(candidate => candidate.id === applicationId)
  if (!entry) throw new Error('该软件不在本机软件目录中，请重新搜索')

  if (entry.kind === 'manual') {
    const errorMessage = await shell.openPath(entry.target)
    if (errorMessage) throw new Error(`无法打开${entry.name}：${errorMessage}`)
  } else {
    await new Promise((resolve, reject) => {
      const child = spawn('explorer.exe', [`shell:AppsFolder\\${entry.target}`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })
      child.once('error', error => reject(new Error(`无法打开${entry.name}：${error.message}`)))
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })
  }
  return `已打开${entry.name}`
}

async function chooseApplicationFile(event, aliasValue) {
  const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow
  const selection = await dialog.showOpenDialog(parent, {
    title: `选择“${String(aliasValue || '').trim()}”的启动文件`,
    properties: ['openFile'],
    filters: [{ name: 'Windows 软件', extensions: ['exe', 'lnk'] }]
  })
  if (selection.canceled || !selection.filePaths[0]) return null

  const selected = selection.filePaths[0]
  const extension = path.extname(selected).toLowerCase()
  if (!['.exe', '.lnk'].includes(extension)) throw new Error('只能添加 Windows 可执行文件或快捷方式')
  const name = String(aliasValue || '').trim()
  if (!name) throw new Error('软件名称不能为空')

  const manual = readManualApplications().filter(entry => entry.path.toLowerCase() !== selected.toLowerCase())
  manual.push({ name, path: selected })
  writeManualApplications(manual)
  await refreshCatalog()
  const entry = catalog.find(candidate => candidate.kind === 'manual' && candidate.target.toLowerCase() === selected.toLowerCase())
  return { id: entry.id, name: entry.name, source: entry.source }
}

async function listTopLevelWindows() {
  const script = [
    'Add-Type @\"',
    'using System;',
    'using System.Text;',
    'using System.Runtime.InteropServices;',
    'using System.Collections.Generic;',
    'public static class WinList {',
    '  public delegate bool EnumProc(IntPtr h, IntPtr l);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
    '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);',
    '  public static List<string> List() {',
    '    var result = new List<string>();',
    '    EnumWindows((h, l) => {',
    '      var t = new StringBuilder(512); GetWindowText(h, t, 512);',
    '      var c = new StringBuilder(256); GetClassName(h, c, 256);',
    '      result.Add(h.ToInt64().ToString() + "|" + IsWindowVisible(h) + "|" + IsIconic(h) + "|" + c.ToString() + "|" + t.ToString());',
    '      return true;',
    '    }, IntPtr.Zero);',
    '    return result;',
    '  }',
    '}',
    '\"@',
    '[WinList]::List() | ForEach-Object { $_ }'
  ].join('\n')

  const output = await runPowerShell(script)
  return output.split(/\r?\n/).filter(Boolean).map(line => {
    const [handle, visible, iconic, className, ...rest] = line.split('|')
    return { handle, visible: visible === 'True', iconic: iconic === 'True', className, title: rest.join('|') }
  })
}

function nativeHandleString(window) {
  try {
    const buffer = window?.getNativeWindowHandle()
    if (!buffer || !buffer.length) return null
    return (buffer.length >= 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0))).toString()
  } catch {
    return null
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function captureActiveWindow(event) {
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow
  const ownerHandle = nativeHandleString(owner)
  const windows = await listTopLevelWindows()
  const shellClasses = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd'])
  const ownIndex = windows.findIndex(item => item.handle === ownerHandle)
  const ordered = ownIndex >= 0 ? windows.slice(ownIndex + 1) : windows
  const target = ordered.find(item =>
    item.visible && !item.iconic && item.title.trim() &&
    item.handle !== ownerHandle && !shellClasses.has(item.className)
  )
  if (!target) throw new Error('请先打开要查看的窗口再试')

  owner?.hide()
  try {
    // 给 DWM 一点时间更新窗口层，再从桌面捕获里按窗口句柄精确定位目标窗口。
    await delay(300)
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1200 },
      fetchWindowIcons: false
    })
    const byHandle = sources.find(item => item.id.startsWith(`window:${target.handle}:`))
    const normalizedTitle = target.title.trim().toLocaleLowerCase()
    const byTitle = sources.find(item => item.name && item.name.trim().toLocaleLowerCase() === normalizedTitle)
    const source = byHandle || byTitle
    if (!source || source.thumbnail.isEmpty()) throw new Error(`无法截取当前窗口：${target.title}`)
    const title = target.title

    const size = source.thumbnail.getSize()
    const jpeg = source.thumbnail.toJPEG(84)
    return {
      title,
      width: size.width,
      height: size.height,
      mimeType: 'image/jpeg',
      imageData: `data:image/jpeg;base64,${jpeg.toString('base64')}`
    }
  } finally {
    owner?.show()
    owner?.restore()
    owner?.focus()
  }
}

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) require('electron').shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(localOrigin)) event.preventDefault()
  })
}

function keepCompanionsOnTop() {
  // Floating sits below the Windows taskbar. Keep both companion windows in
  // the higher overlay layer, raising the bubble last without taking focus.
  for (const window of [petWindow, bubbleWindow]) {
    if (!window || window.isDestroyed()) continue
    window.setAlwaysOnTop(true, 'screen-saver')
    if (window.isVisible()) window.moveTop()
  }
}

function showPetInactive() {
  const window = petWindow
  if (!window || window.isDestroyed()) return
  window.showInactive()
  keepCompanionsOnTop()
  // A hidden Windows launcher may consume the first native ShowWindow call.
  if (!window.isVisible()) setImmediate(() => {
    if (window.isDestroyed() || quitting || startupPending || petWindow !== window) return
    window.showInactive()
    keepCompanionsOnTop()
  })
}

function createMainWindow() {
  createSplashWindow()
  mainWindow = new BrowserWindow({
    title: '昔涟 AI',
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#21132d',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  secureWindow(mainWindow)
  mainWindow.on('focus', keepCompanionsOnTop)
  mainWindow.once('ready-to-show', () => { mainPainted = true; revealStartup() })
  mainWindow.on('close', event => {
    if (!quitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })
  mainWindow.loadURL(localOrigin)
  // Startup never depends on the chat/history API or an animation decoder.
  startupTimer = setTimeout(() => {
    mainPainted = true; wallpaperReady = true; splashFinished = true; revealStartup()
  }, 7000)
}

function createSplashWindow() {
  try {
    const preferences = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'startup-preferences.json'), 'utf8'))
    if (preferences.disabled) { splashFinished = true; return }
  } catch { /* First launch uses the welcome animation. */ }
  splashWindow = new BrowserWindow({ width: 760, height: 480, show: false, frame: false,
    transparent: true, backgroundColor: '#00000000', resizable: false, maximizable: false,
    fullscreenable: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true } })
  secureWindow(splashWindow)
  splashWindow.once('ready-to-show', () => { if (!splashFinished) splashWindow?.show() })
  splashWindow.on('closed', () => { splashWindow = null; splashFinished = true; revealStartup() })
  splashWindow.loadURL(`${localOrigin}?view=splash`)
}

function revealStartup() {
  if (!startupPending || !mainPainted || !wallpaperReady || !splashFinished || quitting) return
  startupPending = false
  clearTimeout(startupTimer)
  splashWindow?.destroy()
  mainWindow?.show()
  // A hidden VBS/PowerShell launcher can supply SW_HIDE for the first native
  // ShowWindow call. Retry once after that startup state has been consumed.
  if (mainWindow && !mainWindow.isVisible()) setImmediate(() => { if (!quitting && !mainWindow?.isDestroyed()) mainWindow?.show() })
  showPetInactive()
}

function positionBubble() {
  if (!bubbleWindow || bubbleWindow.isDestroyed() || !petWindow || petWindow.isDestroyed()) return
  const bounds = petWindow.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  const [width, height] = bubbleWindow.getSize()
  const position = bubblePosition(bounds, { width, height }, area)
  bubbleWindow.setPosition(position.x, position.y)
}

function hideBubble() {
  bubbleWanted = false
  clearTimeout(bubbleTimer)
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return
  bubbleWindow.webContents.send('desktop:pet-event', { type: 'bubble-hidden' })
  bubbleWindow.hide()
}

function showBubble(mode = 'chat') {
  if (!petWindow || petWindow.isDestroyed()) return
  if (mode === 'response' && bubbleWindow?.isVisible() && bubbleState.mode === 'chat') return
  clearTimeout(bubbleTimer)
  bubbleWanted = true
  const lines = ['嗯，我在。', '有什么想说的吗？我听着。', '慢慢来，我会陪着你。', '见到你，真好。']
  bubbleState = { mode, line: lines[Math.floor(Math.random() * lines.length)] }
  const height = mode === 'chat' ? Math.min(470, screen.getDisplayMatching(petWindow.getBounds()).workArea.height - 16) : 164
  const present = () => {
    if (!bubbleWanted || !bubbleReady || !bubbleWindow || bubbleWindow.isDestroyed()) return
    bubbleWindow.webContents.send('desktop:pet-event', { type: 'bubble-state', ...bubbleState })
    if (bubbleState.mode === 'chat') { bubbleWindow.show(); bubbleWindow.focus() }
    else {
      bubbleWindow.showInactive()
      clearTimeout(bubbleTimer)
      bubbleTimer = setTimeout(hideBubble, 4800)
    }
  }
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    bubbleReady = false
    bubbleWindow = new BrowserWindow({ title: '昔涟气泡对话', width: 360, height, show: false, frame: false,
      transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true } })
    secureWindow(bubbleWindow)
    keepCompanionsOnTop()
    bubbleWindow.on('page-title-updated', event => event.preventDefault())
    bubbleWindow.on('show', keepCompanionsOnTop)
    bubbleWindow.on('restore', keepCompanionsOnTop)
    bubbleWindow.once('ready-to-show', () => { bubbleReady = true; present() })
    bubbleWindow.on('closed', () => { bubbleWindow = null; bubbleReady = false; bubbleWanted = false; clearTimeout(bubbleTimer) })
    bubbleWindow.loadURL(`${localOrigin}?view=pet-chat`)
  } else {
    bubbleWindow.setSize(360, height)
    present()
  }
  positionBubble()
}

function endPetDrag() {
  clearInterval(dragTimer)
  dragTimer = null
  const dragged = Boolean(dragState?.dragged)
  dragState = null
  savePetPosition()
  return { dragged }
}

function beginPetDrag() {
  endPetDrag()
  if (!petWindow || petWindow.isDestroyed()) return
  dragState = { cursor: screen.getCursorScreenPoint(), bounds: petWindow.getBounds(), dragged: false, at: Date.now() }
  dragTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || Date.now() - dragState.at > 15000) { endPetDrag(); return }
    const cursor = screen.getCursorScreenPoint()
    const result = dragPosition(dragState, cursor, screen.getDisplayNearestPoint(cursor).workArea)
    dragState.dragged ||= result.dragged
    if (dragState.dragged) petWindow.setPosition(result.x, result.y)
  }, 16)
}

function createVoiceWindow(conversationId) {
  if (voiceWindow && !voiceWindow.isDestroyed()) {
    voiceWindow.show()
    voiceWindow.focus()
    return
  }
  voiceWindow = new BrowserWindow({
    title: '与昔涟通话',
    width: 345,
    height: 595,
    minWidth: 320,
    minHeight: 520,
    parent: mainWindow,
    show: false,
    backgroundColor: '#21132d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  secureWindow(voiceWindow)
  voiceWindow.once('ready-to-show', () => voiceWindow.show())
  voiceWindow.on('closed', () => { voiceWindow = null })
  const query = new URLSearchParams({ view: 'voice-call', conversationId })
  voiceWindow.loadURL(`${localOrigin}?${query}`)
}

function petWindowStatePath() {
  return path.join(app.getPath('userData'), 'desktop-pet-window.json')
}

function defaultPetPosition(width, height) {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: Math.round(workArea.x + workArea.width - width - 18),
    y: Math.round(workArea.y + workArea.height - height - 12)
  }
}

function readPetPosition(width, height) {
  try {
    const saved = JSON.parse(fs.readFileSync(petWindowStatePath(), 'utf8'))
    const point = screen.getDisplayMatching({ x: saved.x, y: saved.y, width, height })?.workArea
    if (!point) return defaultPetPosition(width, height)
    const x = Math.max(point.x, Math.min(saved.x, point.x + point.width - width))
    const y = Math.max(point.y, Math.min(saved.y, point.y + point.height - height))
    return { x: Math.round(x), y: Math.round(y) }
  } catch {
    return defaultPetPosition(width, height)
  }
}

function savePetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return
  const [x, y] = petWindow.getPosition()
  try {
    fs.writeFileSync(petWindowStatePath(), JSON.stringify({ x, y }), 'utf8')
  } catch (error) {
    console.warn('Unable to save desktop pet position:', error.message)
  }
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    showPetInactive()
    return
  }

  const width = 340
  const height = 390
  const position = readPetPosition(width, height)
  petWindow = new BrowserWindow({
    title: '昔涟桌宠',
    width,
    height,
    x: position.x,
    y: position.y,
    minWidth: width,
    minHeight: height,
    maxWidth: width,
    maxHeight: height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  keepCompanionsOnTop()
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  secureWindow(petWindow)
  petWindow.on('page-title-updated', event => event.preventDefault())
  petWindow.on('show', keepCompanionsOnTop)
  petWindow.on('restore', keepCompanionsOnTop)
  petWindow.once('ready-to-show', () => { if (!startupPending) showPetInactive() })
  petWindow.on('moved', () => { positionBubble(); if (!dragState) savePetPosition() })
  petWindow.on('hide', hideBubble)
  petWindow.on('close', event => {
    if (!quitting) {
      event.preventDefault()
      petWindow.hide()
    }
  })
  petWindow.on('closed', () => { endPetDrag(); bubbleWindow?.destroy(); petWindow = null })
  petWindow.loadURL(`${localOrigin}?view=desktop-pet`)
}

function togglePetWindow() {
  if (!petWindow || petWindow.isDestroyed()) {
    createPetWindow()
    return
  }
  if (petWindow.isVisible()) petWindow.hide()
  else showPetInactive()
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'))
  tray = new Tray(icon)
  tray.setToolTip('昔涟 AI')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { label: '显示/隐藏桌宠', click: togglePetWindow },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } }
  ]))
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus() })
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    let target
    try {
      target = new URL(API_ORIGIN)
      if (!['http:', 'https:'].includes(target.protocol)) throw new Error('unsupported protocol')
    } catch {
      reject(new Error('TALK_AI_DESKTOP_API_URL 必须是有效的 HTTP(S) 地址'))
      return
    }

    let apiPathMode
    try {
      apiPathMode = resolveApiPathMode(target, process.env.TALK_AI_DESKTOP_API_PATH_MODE)
    } catch (error) {
      reject(error)
      return
    }

    const webRoot = path.resolve(__dirname, '..', 'dist')
    const proxy = httpProxy.createProxyServer({ target: target.toString(), changeOrigin: true, ws: true })
    proxy.on('proxyReq', request => request.removeHeader('origin'))
    proxy.on('proxyReqWs', request => request.removeHeader('origin'))
    proxy.on('error', (error, _request, response) => {
      console.error('API proxy error:', error.message)
      if (response?.writeHead && !response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
      response?.end?.(JSON.stringify({ message: '桌面端无法连接后端服务' }))
    })

    localServer = http.createServer((request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        request.url = rewriteApiRequestUrl(request.url, apiPathMode)
        proxy.web(request, response)
        return
      }

      let pathname
      try { pathname = decodeURIComponent(url.pathname) } catch { pathname = '/' }
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
      let filePath = path.resolve(webRoot, relative)
      if (!filePath.startsWith(`${webRoot}${path.sep}`) && filePath !== webRoot) {
        response.writeHead(403).end()
        return
      }
      const isLive2DAsset = pathname.startsWith('/live2d/')
      const isPetAsset = pathname.startsWith('/pets/')
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        // Live2D assets must 404 instead of falling back to index.html;
        // otherwise the loader tries to parse HTML as JSON and reports a
        // confusing syntax error.
        if (isLive2DAsset || isPetAsset) {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found')
          return
        }
        filePath = path.join(webRoot, 'index.html')
      }
      fs.readFile(filePath, (error, content) => {
        if (error) {
          response.writeHead(404).end('Not found')
          return
        }
        const noStore = filePath.endsWith('index.html') || ((isLive2DAsset || isPetAsset) && filePath.endsWith('.json'))
        response.writeHead(200, {
          'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': noStore ? 'no-store' : 'public, max-age=31536000, immutable'
        })
        response.end(content)
      })
    })
    localServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        request.url = rewriteApiRequestUrl(request.url, apiPathMode)
        proxy.ws(request, socket, head)
      }
      else socket.destroy()
    })
    // Keep a stable loopback origin between launches so localStorage (including
    // user identity, pet conversation and preferences) survives a restart.
    const portFile = path.join(app.getPath('userData'), 'desktop-server-port.json')
    let preferredPort = 0
    try {
      const saved = JSON.parse(fs.readFileSync(portFile, 'utf8')).port
      if (Number.isInteger(saved) && saved > 0 && saved <= 65535) preferredPort = saved
    } catch { /* Choose an available port on the first launch. */ }
    let retrying = false
    localServer.on('error', error => {
      if (error.code === 'EADDRINUSE' && preferredPort && !retrying) {
        retrying = true
        localServer.listen(0, '127.0.0.1')
      } else reject(error)
    })
    localServer.once('listening', () => {
      const address = localServer.address()
      localOrigin = `http://127.0.0.1:${address.port}/`
      try { fs.writeFileSync(portFile, JSON.stringify({ port: address.port }), 'utf8') } catch (error) { console.warn('Unable to save local server port:', error.message) }
      resolve()
    })
    localServer.listen(preferredPort, '127.0.0.1')
  })
}

function registerDesktopCommands() {
  ipcMain.handle('desktop:search_applications', (_event, args) => searchApplications(args?.query))
  ipcMain.handle('desktop:open_application', (_event, args) => openApplication(args?.application))
  ipcMain.handle('desktop:choose_application_file', (event, args) => chooseApplicationFile(event, args?.alias))
  ipcMain.handle('desktop:capture_active_window', event => captureActiveWindow(event))
  ipcMain.handle('desktop:open_voice_call', (_event, args) => {
    const conversationId = String(args?.conversationId || '')
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(conversationId)) throw new Error('无效的通话会话')
    createVoiceWindow(conversationId)
  })
  ipcMain.handle('desktop:pet_open_chat', (_event, args) => {
    focusMainWindow()
    if (/^[\w-]{1,128}$/.test(args?.conversationId || '')) {
      mainWindow?.webContents.send('desktop:pet-event', { type: 'open-conversation', conversationId: args.conversationId })
    }
    return true
  })
  ipcMain.handle('desktop:pet_hide', () => {
    endPetDrag()
    petWindow?.hide()
    return true
  })
  const fromPet = event => event.sender === petWindow?.webContents
  const fromBubble = event => event.sender === bubbleWindow?.webContents
  ipcMain.handle('desktop:pet_respond', event => { if (fromPet(event)) showBubble('response') })
  ipcMain.handle('desktop:pet_open_bubble', event => { if (fromPet(event) || fromBubble(event)) showBubble('chat') })
  ipcMain.handle('desktop:pet_close_bubble', event => { if (fromBubble(event)) hideBubble() })
  ipcMain.handle('desktop:pet_bubble_state', event => fromBubble(event) ? bubbleState : null)
  ipcMain.handle('desktop:pet_drag_begin', event => { if (fromPet(event)) beginPetDrag() })
  ipcMain.handle('desktop:pet_drag_end', event => fromPet(event) ? endPetDrag() : { dragged: false })
  ipcMain.handle('desktop:startup_ready', event => {
    if (event.sender === mainWindow?.webContents) { wallpaperReady = true; revealStartup() }
  })
  ipcMain.handle('desktop:splash_finish', (event, args) => {
    if (event.sender !== splashWindow?.webContents) return
    if (args?.disable === true) {
      try { fs.writeFileSync(path.join(app.getPath('userData'), 'startup-preferences.json'), JSON.stringify({ disabled: true }), 'utf8') }
      catch (error) { console.warn('Unable to save startup preference:', error.message) }
    }
    splashFinished = true
    revealStartup()
    splashWindow?.hide()
  })
}

function focusMainWindow() {
  if (startupPending) { splashFinished = true; revealStartup() }
  mainWindow?.show()
  mainWindow?.restore()
  mainWindow?.focus()
}

function showDesktopClient() {
  if (!app.isReady() || !localOrigin) return
  showDesktopWindows({ focusMainWindow, createPetWindow })
}

// 这台机器上 Electron 自带的 ProcessSingleton 会以
// “Lock file can not be created! Error code: 5” 失败，单实例改用命名管道实现。
const INSTANCE_PIPE = '\\\\.\\pipe\\com.xzzz.talkwithai.electron'
let instanceServer = null

function claimInstance() {
  return new Promise(resolve => {
    const server = net.createServer(socket => {
      socket.once('data', showDesktopClient)
      socket.end('ok')
    })
    server.once('error', error => {
      if (error.code === 'EADDRINUSE') {
        resolve(null)
        return
      }
      console.warn('Single-instance pipe unavailable:', error.message)
      resolve(server)
    })
    server.listen(INSTANCE_PIPE, () => resolve(server))
  })
}

function notifyExistingInstance() {
  return new Promise(resolve => {
    const socket = net.connect(INSTANCE_PIPE)
    const timer = setTimeout(() => { socket.destroy(); resolve() }, 1200)
    socket.once('connect', () => { socket.resume(); socket.end('show') })
    socket.once('close', () => { clearTimeout(timer); resolve() })
    socket.once('error', () => { clearTimeout(timer); socket.destroy(); resolve() })
  })
}

claimInstance().then(async server => {
  if (!server) {
    await notifyExistingInstance()
    app.quit()
    return
  }
  instanceServer = server

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.xzzz.talkwithai.electron')
    Menu.setApplicationMenu(null)
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'media')
    })
    registerDesktopCommands()
    await startLocalServer()
    void startDesktopWindows({
      createMainWindow,
      createPetWindow,
      createTray,
      refreshCatalog,
      onCatalogError: error => console.warn('Unable to refresh application catalog:', error.message)
    })
  }).catch(error => {
    dialog.showErrorBox('昔涟 AI 启动失败', error.stack || error.message)
    app.quit()
  })
})

app.on('before-quit', () => { quitting = true; clearTimeout(startupTimer); clearTimeout(bubbleTimer); endPetDrag() })
app.on('activate', () => {
  if (app.isReady() && localOrigin) showDesktopClient()
})
app.on('window-all-closed', () => {})
app.on('quit', () => {
  localServer?.close()
  instanceServer?.close()
})
