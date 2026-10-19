export function voiceSocketUrl(apiPath, pageOrigin) {
  const url = new URL(apiPath, pageOrigin)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('语音服务地址无效')
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export function decodePcm16(base64) {
  const binary = atob(base64)
  if (binary.length % 2) throw new Error('语音分片长度无效')
  const view = new DataView(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) view.setUint8(i, binary.charCodeAt(i))
  const samples = new Float32Array(binary.length / 2)
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768
  return samples
}

export function formatCallDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

export function playedSampleCount(segments, now, completed = 0) {
  let played = completed
  for (const segment of segments) {
    if (now < segment.start) break
    const fraction = Math.max(0, Math.min(1, (now - segment.start) / (segment.end - segment.start)))
    played += Math.floor(fraction * segment.samples)
    if (fraction < 1) break
  }
  return played
}
