export function resolveChatUser(storage = localStorage) {
  const key = 'spring-ai-test-user-id'
  const stored = storage.getItem(key)
  if (stored) return stored
  const id = storage.getItem('spring-ai-test-conversations') ? 'default'
    : globalThis.crypto?.randomUUID?.() || `u-${Date.now()}-${Math.random().toString(16).slice(2)}`
  storage.setItem(key, id)
  return id
}
