const { contextBridge, ipcRenderer } = require('electron')
// Used only by smoke_tool_dialog.cjs, never included in the packaged client.
contextBridge.exposeInMainWorld('xilianDesktop', {
  runtime: 'electron',
  invoke: (command, args) => ipcRenderer.invoke('dialog-smoke', command, args),
  onPetEvent: () => () => {}
})
