// Live2D runtime configuration.
// Keep the feature disabled until the Cubism export exists under
// public/live2d/xilian/. Then flip LIVE2D_ENABLED to true and wire the
// component into the page.

export const LIVE2D_ENABLED = false

export const MODEL_URL = '/live2d/xilian-v4-staging/xilian.model3.json'
export const CORE_URL = '/live2d/core/live2dcubismcore.min.js'
export const FALLBACK_IMAGE = '/xilian-pet-standing.png'

export const MOTIONS = Object.freeze({
  idle: 'Idle',
  talk: 'Talk',
  tapHead: 'TapHead',
  tapBody: 'TapBody',
  greeting: 'Greeting'
})

export const EXPRESSIONS = Object.freeze({
  neutral: '',
  smile: 'smile',
  shy: 'shy',
  sad: 'sad',
  angry: 'angry',
  surprised: 'surprised',
  sleepy: 'sleepy'
})

export const HIT_ACTIONS = Object.freeze({
  Head: { motion: 'TapHead', expression: 'surprised', resetExpression: 'smile', cooldownMs: 600 },
  Body: { motion: 'TapBody', expression: 'shy', resetExpression: 'smile', cooldownMs: 800 }
})

export const MOUTH_PARAM = 'ParamMouthOpenY'
