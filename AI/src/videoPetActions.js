export const VIDEO_PET_ROOT = '/pets/xilian-video-v2/'

export function validatePetManifest(manifest) {
  if (manifest?.renderer !== 'alpha-video' || !manifest.actions?.idle) throw new Error('桌宠素材清单无效')
  for (const [id, action] of Object.entries(manifest.actions)) {
    if (!/^[\w-]+\.webm$/.test(action?.file || '')) throw new Error(`桌宠素材路径无效：${id}`)
  }
  for (const key of ['ambient', 'tap', 'speech']) {
    const pool = manifest.pools?.[key]
    if (!Array.isArray(pool) || pool.length === 0 || pool.some(item =>
      !manifest.actions[item.action] || !Number.isFinite(item.weight) || item.weight <= 0)) {
      throw new Error(`桌宠动作池无效：${key}`)
    }
  }
  return manifest
}

export function pickPetAction(manifest, pool, random = Math.random) {
  const entries = manifest.pools[pool]
  const total = entries.reduce((sum, item) => sum + item.weight, 0)
  let cursor = random() * total
  for (const item of entries) {
    cursor -= item.weight
    if (cursor < 0) return item.action
  }
  return entries.at(-1).action
}
