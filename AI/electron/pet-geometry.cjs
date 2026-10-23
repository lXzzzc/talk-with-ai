function clampPosition(bounds, area) {
  return {
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)))
  }
}

function bubblePosition(pet, size, area) {
  const gap = 10
  const leftFits = pet.x - size.width - gap >= area.x
  const rightFits = pet.x + pet.width + size.width + gap <= area.x + area.width
  return clampPosition({ ...size,
    x: leftFits ? pet.x - size.width - gap : rightFits ? pet.x + pet.width + gap : pet.x,
    y: leftFits || rightFits ? pet.y + 20 : pet.y - size.height - gap
  }, area)
}

function dragPosition(start, cursor, area) {
  const dx = cursor.x - start.cursor.x, dy = cursor.y - start.cursor.y
  const dragged = Math.hypot(dx, dy) >= 6
  return { dragged, ...clampPosition({ ...start.bounds,
    x: start.bounds.x + dx, y: start.bounds.y + dy }, area) }
}
module.exports = { bubblePosition, dragPosition }
