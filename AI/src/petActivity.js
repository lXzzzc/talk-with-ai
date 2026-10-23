// Window-local sources are announced with a heartbeat, so a closed or crashed
// chat cannot leave the pet permanently listening or thinking.
const owner = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
const local = new Map()
const remote = new Map()
const listeners = new Set()
const states = ['typing', 'listening', 'thinking']
let channel
let heartbeat

export function resolvePetActivity(values) {
  for (const state of ['thinking', 'listening', 'typing']) if (values.includes(state)) return state
  return 'idle'
}

function current() {
  return resolvePetActivity([...local.values(), ...[...remote.values()]
    .filter(item => Date.now() - item.at < 6500).map(item => item.state)])
}
function notify() { for (const listener of listeners) listener(current()) }
function announce() { channel?.postMessage({ type: 'activity', owner, state: resolvePetActivity([...local.values()]) }) }
function connect() {
  if (channel || !globalThis.BroadcastChannel) return
  channel = new BroadcastChannel('xilian-pet-activity-v1')
  channel.onmessage = ({ data }) => {
    if (!data || data.owner === owner) return
    if (data.type === 'request') { announce(); return }
    if (data.type !== 'activity' || typeof data.owner !== 'string' || !['idle', ...states].includes(data.state)) return
    if (data.state === 'idle') remote.delete(data.owner)
    else remote.set(data.owner, { state: data.state, at: Date.now() })
    notify()
  }
  channel.postMessage({ type: 'request', owner })
  heartbeat = setInterval(() => {
    if (local.size) announce()
    for (const [id, item] of remote) if (Date.now() - item.at >= 6500) remote.delete(id)
    notify()
  }, 2000)
  heartbeat.unref?.()
  globalThis.addEventListener?.('pagehide', () => {
    local.clear(); announce(); clearInterval(heartbeat); channel?.close(); channel = null
  }, { once: true })
}

export function setPetActivity(source, state = 'idle') {
  connect()
  if (states.includes(state)) local.set(source, state)
  else local.delete(source)
  announce(); notify()
}
export function subscribePetActivity(listener) {
  connect(); listeners.add(listener); listener(current())
  return () => listeners.delete(listener)
}
