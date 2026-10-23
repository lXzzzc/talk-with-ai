const { contextBridge, ipcRenderer } = require('electron')

const allowedCommands = new Set([
  'open_application',
  'search_applications',
  'choose_application_file',
  'capture_active_window',
  'open_voice_call',
  'pet_open_chat',
  'pet_hide'
])

contextBridge.exposeInMainWorld('xilianDesktop', Object.freeze({
  runtime: 'electron',
  invoke(command, arguments_ = {}) {
    if (!allowedCommands.has(command)) return Promise.reject(new Error('不支持的桌面命令'))
    return ipcRenderer.invoke(`desktop:${command}`, arguments_)
  }
}))
