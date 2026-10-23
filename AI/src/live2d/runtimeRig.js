const DEG = Math.PI / 180

const OPEN_EYES = {
  left: ['eye_sclera_left', 'eye_iris_left', 'eye_highlight_left'],
  right: ['eye_sclera_right', 'eye_iris_right', 'eye_highlight_right']
}

const CLOSED_EYES = {
  left: ['eye_closed_left'],
  right: ['eye_closed_right']
}

const HEAD = [
  'scalp_fill', 'face_underlay',
  ...OPEN_EYES.left, ...OPEN_EYES.right,
  ...CLOSED_EYES.left, ...CLOSED_EYES.right,
  'mouth_closed', 'mouth_open',
  'hair_crown', 'hair_side_left', 'hair_bangs_left', 'hair_bangs_center',
  'hair_bangs_right', 'hair_side_right', 'ornament_hair_fill',
  'head_ornament', 'head_ornament_right'
]

const FRONT_HAIR = [
  'hair_crown', 'hair_side_left', 'hair_bangs_left', 'hair_bangs_center',
  'hair_bangs_right', 'hair_side_right', 'ornament_hair_fill',
  'head_ornament', 'head_ornament_right'
]

const BACK_HAIR_LEFT = ['back_hair_left']
const BACK_HAIR_RIGHT = ['back_hair_right']
const BODY = ['torso_fill', 'torso', 'waist_corsage']
const ARM_LEFT = ['arm_left', 'arm_left_cleanup']
const ARM_RIGHT = ['arm_right']
const SKIRT_LEFT = ['skirt_front_left', 'tail_outer_left', 'tail_inner_left']
const SKIRT_RIGHT = ['skirt_front_right', 'tail_inner_right', 'tail_outer_right']

export function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Fallback blink used only when Cubism's EyeBlink controller is unavailable. */
export function runtimeBlinkOpen(timeMs) {
  const phase = ((timeMs % 4200) + 4200) % 4200
  if (phase < 105) return 1 - phase / 105
  if (phase < 180) return (phase - 105) / 75
  if (phase >= 260 && phase < 335) return 1 - (phase - 260) / 75
  if (phase >= 335 && phase < 405) return (phase - 335) / 70
  return 1
}

export function actionEnvelope(progress) {
  const p = Math.min(1, Math.max(0, progress))
  return Math.sin(Math.PI * p)
}

/**
 * The closed-eye drawings are replacement sprites, not eyelid masks. They
 * must never be cross-faded with the iris/sclera or both states leave a
 * visible ghost. Keep the threshold slightly below half-open so a blink still
 * reads as quick and natural.
 */
export function replacementEyeOpen(value) {
  return value >= 0.44 ? 1 : 0
}

function noopRig() {
  return {
    active: false,
    destroy() {},
    play() {},
    setFocus() {},
    setMouth() {}
  }
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now()
}

export function createRuntimeRig(internalModel) {
  const core = internalModel?.coreModel
  const raw = core?._model
  const drawables = raw?.drawables
  const parameters = raw?.parameters
  if (!core || !drawables?.ids || !drawables?.vertexPositions || !drawables?.opacities) {
    return noopRig()
  }

  const drawableIndex = new Map(Array.from(drawables.ids, (id, index) => [String(id), index]))
  const parameterIndex = new Map(Array.from(parameters?.ids || [], (id, index) => [String(id), index]))
  const boundsCache = new Map()
  const originalUpdate = core.update.bind(core)
  const startedAt = nowMs()
  let mouth = 0
  let focusX = 0
  let focusY = 0
  let action = null

  const existingIds = ids => ids.filter(id => drawableIndex.has(id))
  const allIds = Array.from(drawableIndex.keys())

  function setOpacity(ids, value) {
    const opacity = Math.min(1, Math.max(0, value))
    for (const id of ids) {
      const index = drawableIndex.get(id)
      if (index !== undefined) drawables.opacities[index] = opacity
    }
  }

  function parameterValue(id, fallback) {
    const index = parameterIndex.get(id)
    if (index === undefined) return fallback
    const value = parameters.values[index]
    return Number.isFinite(value) ? value : fallback
  }

  function boundsFor(ids) {
    const present = existingIds(ids)
    const key = present.join('|')
    if (boundsCache.has(key)) return boundsCache.get(key)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const id of present) {
      const vertices = drawables.vertexPositions[drawableIndex.get(id)]
      if (!vertices) continue
      for (let i = 0; i < vertices.length; i += 2) {
        minX = Math.min(minX, vertices[i])
        minY = Math.min(minY, vertices[i + 1])
        maxX = Math.max(maxX, vertices[i])
        maxY = Math.max(maxY, vertices[i + 1])
      }
    }
    const bounds = Number.isFinite(minX)
      ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
      : null
    boundsCache.set(key, bounds)
    return bounds
  }

  function transform(ids, options = {}) {
    const bounds = boundsFor(ids)
    if (!bounds) return
    const px = options.pivotX ?? (bounds.minX + bounds.maxX) / 2
    const py = options.pivotY ?? (bounds.minY + bounds.maxY) / 2
    const angle = options.angle ?? 0
    const sx = options.scaleX ?? 1
    const sy = options.scaleY ?? 1
    const tx = options.x ?? 0
    const ty = options.y ?? 0
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    for (const id of existingIds(ids)) {
      const vertices = drawables.vertexPositions[drawableIndex.get(id)]
      if (!vertices) continue
      for (let i = 0; i < vertices.length; i += 2) {
        const dx = (vertices[i] - px) * sx
        const dy = (vertices[i + 1] - py) * sy
        vertices[i] = px + dx * cos - dy * sin + tx
        vertices[i + 1] = py + dx * sin + dy * cos + ty
      }
    }
  }

  function actionState(now) {
    if (!action) return { name: '', envelope: 0, wave: 0 }
    const progress = (now - action.startedAt) / action.duration
    if (progress >= 1) {
      action = null
      return { name: '', envelope: 0, wave: 0 }
    }
    return {
      name: action.name,
      envelope: actionEnvelope(progress),
      wave: Math.sin(progress * Math.PI * 6) * actionEnvelope(progress)
    }
  }

  function applyRig() {
    const now = nowMs()
    const elapsed = (now - startedAt) / 1000
    const idleA = Math.sin(elapsed * 1.45)
    const idleB = Math.sin(elapsed * 0.83 + 0.7)
    const currentAction = actionState(now)

    const eyeFallback = runtimeBlinkOpen(now - startedAt + 900)
    const eyeLeft = parameterValue('ParamEyeLOpen', eyeFallback)
    const eyeRight = parameterValue('ParamEyeROpen', eyeFallback)
    const leftOpenOpacity = replacementEyeOpen(eyeLeft)
    const rightOpenOpacity = replacementEyeOpen(eyeRight)
    setOpacity(OPEN_EYES.left, leftOpenOpacity)
    setOpacity(OPEN_EYES.right, rightOpenOpacity)
    setOpacity(CLOSED_EYES.left, 1 - leftOpenOpacity)
    setOpacity(CLOSED_EYES.right, 1 - rightOpenOpacity)

    const mouthOpenOpacity = smoothstep(0.08, 0.58, mouth)
    setOpacity(['mouth_closed'], 1 - mouthOpenOpacity)
    setOpacity(['mouth_open'], mouthOpenOpacity)

    // The imported CMO currently contains named parameters but no keyed mesh
    // deformation. Apply a restrained runtime rig so each exported ArtMesh
    // moves independently instead of floating as one flat texture.
    const greeting = currentAction.name === 'Greeting' ? currentAction.envelope : 0
    const tapHead = currentAction.name === 'TapHead' ? currentAction.envelope : 0
    const tapBody = currentAction.name === 'TapBody' ? currentAction.envelope : 0
    const headBounds = boundsFor(HEAD)
    const bodyBounds = boundsFor(BODY)
    const leftArmBounds = boundsFor(ARM_LEFT)
    const rightArmBounds = boundsFor(ARM_RIGHT)
    const leftHairBounds = boundsFor(BACK_HAIR_LEFT)
    const rightHairBounds = boundsFor(BACK_HAIR_RIGHT)
    const leftSkirtBounds = boundsFor(SKIRT_LEFT)
    const rightSkirtBounds = boundsFor(SKIRT_RIGHT)

    if (bodyBounds) {
      transform(BODY, {
        pivotY: bodyBounds.minY,
        scaleY: 1 + 0.006 * (idleA + 1) / 2 + tapBody * 0.012,
        y: idleB * 0.0015
      })
    }
    if (headBounds) {
      transform(HEAD, {
        pivotY: headBounds.minY + headBounds.height * 0.12,
        angle: (idleB * 1.35 + focusX * 3.2 - greeting * 2.4 + tapHead * 2.8) * DEG,
        x: focusX * 0.006,
        y: -focusY * 0.004 + idleA * 0.0025 - tapHead * 0.008
      })
    }

    const eyeShiftX = focusX * 0.004
    const eyeShiftY = -focusY * 0.0025
    transform(['eye_iris_left', 'eye_highlight_left', 'eye_iris_right', 'eye_highlight_right'], {
      x: eyeShiftX,
      y: eyeShiftY
    })

    const frontHairBounds = boundsFor(FRONT_HAIR)
    if (frontHairBounds) {
      transform(FRONT_HAIR, {
        pivotY: frontHairBounds.maxY - frontHairBounds.height * 0.12,
        angle: (-idleA * 0.75 - focusX * 0.8) * DEG
      })
    }
    if (leftHairBounds) {
      transform(BACK_HAIR_LEFT, {
        pivotY: leftHairBounds.maxY - leftHairBounds.height * 0.12,
        angle: (idleA * 2.8 + idleB * 0.9 - focusX) * DEG
      })
    }
    if (rightHairBounds) {
      transform(BACK_HAIR_RIGHT, {
        pivotY: rightHairBounds.maxY - rightHairBounds.height * 0.12,
        angle: (-idleA * 2.5 - idleB * 0.8 - focusX) * DEG
      })
    }

    if (leftArmBounds) {
      transform(ARM_LEFT, {
        pivotX: leftArmBounds.maxX - leftArmBounds.width * 0.18,
        pivotY: leftArmBounds.maxY - leftArmBounds.height * 0.12,
        angle: (-idleB * 1.4 - greeting * 4.5) * DEG
      })
    }
    if (rightArmBounds) {
      transform(ARM_RIGHT, {
        pivotX: rightArmBounds.minX + rightArmBounds.width * 0.18,
        pivotY: rightArmBounds.maxY - rightArmBounds.height * 0.12,
        angle: (idleB * 1.4 + currentAction.wave * 12 + greeting * 5) * DEG
      })
    }
    if (leftSkirtBounds) {
      transform(SKIRT_LEFT, {
        pivotY: leftSkirtBounds.maxY - leftSkirtBounds.height * 0.08,
        angle: (idleB * 1.8 + idleA * 0.7) * DEG
      })
    }
    if (rightSkirtBounds) {
      transform(SKIRT_RIGHT, {
        pivotY: rightSkirtBounds.maxY - rightSkirtBounds.height * 0.08,
        angle: (-idleB * 1.8 - idleA * 0.7) * DEG
      })
    }

    // Touch every vertex group at least once before rendering. Cubism's WebGL
    // renderer uploads the current arrays each draw, so the changes remain
    // local to this frame and Core supplies a clean base on the next frame.
    void allIds.length
  }

  function patchedUpdate() {
    const mouthIndex = parameterIndex.get('ParamMouthOpenY')
    if (mouthIndex !== undefined) core.setParameterValueByIndex(mouthIndex, mouth)
    originalUpdate()
    applyRig()
  }

  core.update = patchedUpdate

  return {
    active: true,
    setMouth(value) {
      mouth = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
    },
    setFocus(x, y) {
      focusX = Math.min(1, Math.max(-1, Number.isFinite(x) ? x : 0))
      focusY = Math.min(1, Math.max(-1, Number.isFinite(y) ? y : 0))
    },
    play(name) {
      const durations = { Greeting: 1900, TapHead: 1100, TapBody: 1350, Talk: 2600 }
      action = { name, startedAt: nowMs(), duration: durations[name] || 1300 }
    },
    destroy() {
      if (core.update === patchedUpdate) core.update = originalUpdate
      boundsCache.clear()
      action = null
    }
  }
}
