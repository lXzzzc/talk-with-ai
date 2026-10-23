// Same-origin speech state shared by chat, voice-call and desktop-pet windows.
const owner = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
const listeners = new Set()
const remote = new Map()
const local = new Set()
let channel = null

function notify() {
  const speaking = local.size > 0 || [...remote.values()].some(at => Date.now() - at < 6500)
  for (const listener of listeners) listener(speaking)
}

function announce() {
  channel?.postMessage({ type: 'speech', owner, active: local.size > 0 })
}

function connect() {
  if (channel || !globalThis.BroadcastChannel) return
  channel = new BroadcastChannel('xilian-pet-speech-v1')
  channel.onmessage = ({ data }) => {
    if (data?.owner === owner) return
    if (data?.type === 'request') { announce(); return }
    if (data?.type !== 'speech' || typeof data.owner !== 'string' || typeof data.active !== 'boolean') return
    if (data.active) remote.set(data.owner, Date.now())
    else remote.delete(data.owner)
    notify()
  }
  channel.postMessage({ type: 'request', owner })
  const heartbeat = setInterval(() => {
    if (local.size) announce()
    for (const [id, at] of remote) if (Date.now() - at >= 6500) remote.delete(id)
    notify()
  }, 2000)
  globalThis.addEventListener?.('pagehide', () => {
    local.clear()
    announce()
    clearInterval(heartbeat)
    channel?.close()
    channel = null
  }, { once: true })
}

export function setPetSpeaking(source, active) {
  connect()
  if (active) local.add(source)
  else local.delete(source)
  announce()
  notify()
}

export function subscribePetSpeech(listener) {
  connect()
  listeners.add(listener)
  notify()
  return () => listeners.delete(listener)
}
