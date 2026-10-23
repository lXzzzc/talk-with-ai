// Desktop windows are part of the client lifecycle, not a separate pet service.
function startDesktopWindows({ createMainWindow, createPetWindow, createTray, refreshCatalog, onCatalogError }) {
  createMainWindow()
  createPetWindow()
  createTray()
  // Discovering installed applications must not delay the client or its pet.
  return Promise.resolve().then(refreshCatalog).catch(onCatalogError)
}

function showDesktopWindows({ focusMainWindow, createPetWindow }) {
  focusMainWindow()
  createPetWindow()
}

module.exports = { startDesktopWindows, showDesktopWindows }
