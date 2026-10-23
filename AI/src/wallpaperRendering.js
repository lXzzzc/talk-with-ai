// Backgrounds don't need to render at retina resolution behind translucent UI.
export function wallpaperRenderSize(width, height, devicePixelRatio = 1) {
  const w = Math.max(1, width), h = Math.max(1, height)
  const ratio = Math.min(Math.max(0.1, devicePixelRatio), 1, Math.sqrt(1920 * 1080 / (w * h)))
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) }
}

export function limitWallpaperResolution(player) {
  const renderer = player.sceneRenderer
  const originalResize = renderer.resize
  renderer.resize = function (mode) {
    // The player uses Expand (1). Preserve vendor behavior for any other mode.
    if (mode !== 1) return originalResize.call(this, mode)
    const canvas = this.canvas
    const size = wallpaperRenderSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio)
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width
      canvas.height = size.height
    }
    this.context.gl.viewport(0, 0, size.width, size.height)
    this.camera.setViewport(size.width, size.height)
    this.camera.update()
  }
}
