// AudioWorklet 的输入采样率由设备决定，跨渲染块重采样到 ASR 所需的 16 kHz。
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.pending = []
    this.position = 0
    this.frame = []
    this.energy = 0
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    this.pending.push(...channel)
    const step = sampleRate / 16000
    while (this.position + step < this.pending.length) {
      // 对一个输出采样覆盖的源区间求加权平均，减少降采样时的混叠。
      const end = this.position + step
      let sum = 0
      for (let i = Math.floor(this.position); i < Math.ceil(end); i++) {
        sum += this.pending[i] * (Math.min(end, i + 1) - Math.max(this.position, i))
      }
      const value = Math.max(-1, Math.min(1, sum / step))
      this.frame.push(Math.round(value * (value < 0 ? 32768 : 32767)))
      this.energy += value * value
      this.position = end
      if (this.frame.length === 640) {
        const pcm = new Int16Array(this.frame)
        this.port.postMessage({ pcm: pcm.buffer, level: Math.sqrt(this.energy / 640) }, [pcm.buffer])
        this.frame = []
        this.energy = 0
      }
    }
    const consumed = Math.floor(this.position)
    this.pending.splice(0, consumed)
    this.position -= consumed
    return true
  }
}

registerProcessor('voice-capture', VoiceCaptureProcessor)
