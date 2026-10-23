const { contextBridge, ipcRenderer } = require('electron')

const allowedCommands = new Set([
  'open_application',
  'search_applications',
  'choose_application_file',
  'capture_active_window',
  'open_voice_call',
  'pet_open_chat',
  'pet_hide',
  'pet_respond', 'pet_open_bubble', 'pet_close_bubble', 'pet_bubble_state',
  'pet_drag_begin', 'pet_drag_end', 'splash_finish', 'startup_ready'
])

contextBridge.exposeInMainWorld('xilianDesktop', Object.freeze({
  runtime: 'electron',
  onPetEvent(callback) {
    if (typeof callback !== 'function') throw new Error('无效的桌宠事件监听器')
    const listener = (_event, data) => callback(data)
    ipcRenderer.on('desktop:pet-event', listener)
    return () => ipcRenderer.removeListener('desktop:pet-event', listener)
  },
  invoke(command, arguments_ = {}) {
    if (!allowedCommands.has(command)) return Promise.reject(new Error('不支持的桌面命令'))
    return ipcRenderer.invoke(`desktop:${command}`, arguments_)
  }
}))
