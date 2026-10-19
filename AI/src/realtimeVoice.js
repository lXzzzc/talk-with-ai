import { apiUrl } from './api.js'
import { decodePcm16, playedSampleCount, voiceSocketUrl } from './voiceProtocol.js'

class PcmPlayer {
  constructor(context) {
    this.context = context
    this.reset()
  }

  enqueue(base64, sampleRate = 24000) {
    const samples = decodePcm16(base64)
    if (!samples.length) return
    if (this.nextTime - this.context.currentTime > 120) throw new Error('语音播放积压，请打断后继续')
    const buffer = this.context.createBuffer(1, samples.length, sampleRate)
    buffer.copyToChannel(samples, 0)
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.gain)
    const start = Math.max(this.context.currentTime + 0.04, this.nextTime)
    const end = start + samples.length / sampleRate
    this.segments.push({ start, end, samples: samples.length })
    this.sources.add(source)
    source.onended = () => { this.sources.delete(source); source.disconnect() }
    source.start(start)
    this.nextTime = end
    this.total += samples.length
  }

  playedSamples() {
    const now = this.context.currentTime
    while (this.segments.length && this.segments[0].end <= now) {
      this.completed += this.segments.shift().samples
    }
    return playedSampleCount(this.segments, now, this.completed)
  }

  reset() {
    for (const source of this.sources || []) { source.onended = null; source.stop(); source.disconnect() }
    this.gain?.disconnect()
    this.gain = this.context.createGain()
    this.gain.connect(this.context.destination)
    this.sources = new Set()
    this.segments = []
    this.nextTime = 0
    this.total = 0
    this.completed = 0
  }

  close() { this.reset(); this.gain.disconnect() }
}

/** 完整通话资源由一个实例持有；挂断或异常时统一释放，不在主界面偷偷录音。 */
export class RealtimeVoiceCall {
  constructor({ context, onEvent, onLevel }) {
    this.initialContext = context
    this.onEvent = onEvent
    this.onLevel = onLevel
    this.stopped = false
    this.muted = false
    this.turnId = null
    this.ready = false
    this.audioDone = false
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioWorkletNode) {
      throw new Error('当前环境不支持实时通话，请使用本机 Chrome 或桌面客户端')
    }
    // 在点击事件中恢复音频，满足浏览器的自动播放策略。
    this.audio = new AudioContext({ latencyHint: 'interactive' })
    try {
      await this.audio.resume()
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true
      }, video: false })
      if (this.stopped) { this.stream.getTracks().forEach(track => track.stop()); return }
      await this.audio.audioWorklet.addModule('/voice-audio-worklet.js')
      if (this.stopped) return
      this.player = new PcmPlayer(this.audio)
      this.source = this.audio.createMediaStreamSource(this.stream)
      this.capture = new AudioWorkletNode(this.audio, 'voice-capture')
      this.silent = this.audio.createGain()
      this.silent.gain.value = 0
      this.source.connect(this.capture)
      this.capture.connect(this.silent).connect(this.audio.destination)
      this.socket = new WebSocket(voiceSocketUrl(apiUrl('/api/voice/realtime'), window.location.origin))
      this.socket.onopen = () => this.send({ type: 'start', ...this.initialContext })
      this.socket.onmessage = event => {
        try { this.receive(JSON.parse(event.data)) }
        catch (error) { this.fail(error.message || '无法播放语音') }
      }
      this.socket.onerror = () => this.fail('无法连接语音服务，请检查本地后端是否启动')
      this.socket.onclose = () => { if (!this.stopped) this.fail('通话连接已断开，请重新拨打') }
      this.capture.port.onmessage = ({ data }) => {
        if (this.stopped) return
        this.onLevel?.(this.muted ? 0 : data.level)
        if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return
        if (this.socket.bufferedAmount > 131072) { this.fail('语音上传拥堵，请检查网络后重试'); return }
        // 静音仍发送零音频，让服务端 VAD 能正常结束上一段语音。
        if (this.muted) new Int16Array(data.pcm).fill(0)
        this.socket.send(data.pcm)
      }
      this.timer = setInterval(() => this.ack(), 100)
      this.connectTimer = setTimeout(() => {
        if (!this.ready) this.fail('建立通话超时，请检查实时识别服务配置')
      }, 25000)
    } catch (error) {
      this.stop()
      if (error.name === 'NotAllowedError') throw new Error('麦克风权限未开启，请允许后重新拨打')
      if (error.name === 'NotFoundError') throw new Error('没有找到可用的麦克风')
      throw error
    }
  }

  receive(event) {
    if (this.stopped) return
    switch (event.type) {
      case 'ready': this.ready = true; clearTimeout(this.connectTimer); break
      case 'transcript.final':
        this.player.reset()
        this.turnId = event.turnId
        this.audioDone = false
        break
      case 'speech.start':
      case 'interrupted':
        this.ack()
        this.player.reset()
        this.turnId = null
        break
      case 'audio.delta':
        if (event.turnId !== this.turnId) return
        this.player.enqueue(event.audio)
        break
      case 'audio.done':
        if (event.turnId !== this.turnId) return
        this.audioDone = true
        this.ack()
        break
      case 'turn.error':
      case 'turn.end':
        if (event.turnId === this.turnId && (event.type === 'turn.error' || event.interrupted)) {
          this.ack()
          this.player.reset()
          this.turnId = null
          this.audioDone = false
        }
        break
      case 'error': this.fail(event.message || '通话发生错误'); return
      default: break
    }
    this.onEvent?.(event)
  }

  ack() {
    if (!this.turnId || !this.player) return
    const samples = this.player.playedSamples()
    this.send({ type: 'playback.ack', turnId: this.turnId, samples })
    if (this.audioDone && samples >= this.player.total) {
      this.audioDone = false
      this.onEvent?.({ type: 'playback.done', turnId: this.turnId })
    }
  }

  send(event) {
    if (!this.stopped && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event))
  }

  updateContext(context) {
    this.initialContext = { ...this.initialContext, ...context }
    if (this.ready) this.send({ type: 'context.update', ...context })
  }

  setMuted(muted) {
    this.muted = muted
    this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted })
    this.send({ type: 'mute', muted })
  }

  interrupt() {
    this.ack()
    this.player?.reset()
    this.send({ type: 'interrupt' })
    this.turnId = null
    this.onEvent?.({ type: 'listening' })
  }

  fail(message) {
    if (this.stopped) return
    this.stop()
    this.onEvent?.({ type: 'error', message })
  }

  stop() {
    if (this.stopped) return
    this.ack()
    this.send({ type: 'end' })
    this.stopped = true
    this.ready = false
    clearInterval(this.timer)
    clearTimeout(this.connectTimer)
    this.stream?.getTracks().forEach(track => track.stop())
    this.capture?.disconnect()
    if (this.capture) this.capture.port.onmessage = null
    this.source?.disconnect()
    this.silent?.disconnect()
    this.player?.close()
    if (this.socket) {
      this.socket.onclose = this.socket.onerror = this.socket.onmessage = null
      this.socket.close()
    }
    if (this.audio?.state !== 'closed') void this.audio?.close()
  }
}
