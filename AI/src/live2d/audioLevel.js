// Audio level helpers for driving ParamMouthOpenY.
// No Pixi/Live2D dependency: safe to use from TTS or voice-call code.

/**
 * Create an analyser that can be inserted after an AudioContext source/gain.
 * @param {AudioContext} context
 * @param {{ fftSize?: number }} [options]
 */
export function createAnalyser(context, options = {}) {
  const analyser = context.createAnalyser()
  analyser.fftSize = options.fftSize ?? 256
  analyser.smoothingTimeConstant = 0.2
  return analyser
}

/**
 * Read a normalized RMS level (0..1) from an analyser.
 * @param {AnalyserNode} analyser
 * @param {Float32Array} [buffer]
 */
export function readRms(analyser, buffer) {
  const data = buffer ?? new Float32Array(analyser.fftSize)
  analyser.getFloatTimeDomainData(data)
  let sum = 0
  for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i]
  return Math.sqrt(sum / data.length)
}

/**
 * Convert RMS to a mouth value. A small noise gate keeps the mouth closed
 * between syllables instead of jittering.
 * @param {number} rms
 * @param {{ gain?: number, gate?: number }} [options]
 */
export function rmsToMouth(rms, options = {}) {
  const gain = options.gain ?? 4
  const gate = options.gate ?? 0.02
  if (!Number.isFinite(rms) || rms < gate) return 0
  return Math.min(1, Math.max(0, rms * gain))
}

/**
 * Asymmetric smoothing: open quickly, close a little slower.
 * @param {number} previous
 * @param {number} next
 * @param {{ attack?: number, release?: number }} [options]
 */
export function smoothMouth(previous, next, options = {}) {
  const attack = options.attack ?? 0.35
  const release = options.release ?? 0.12
  const alpha = next > previous ? attack : release
  return previous + (next - previous) * alpha
}

/**
 * Build a reusable mouth driver around an analyser.
 * @param {AnalyserNode} analyser
 */
export function createMouthDriver(analyser) {
  const buffer = new Float32Array(analyser.fftSize)
  let value = 0
  return {
    reset() {
      value = 0
      return 0
    },
    next() {
      const target = rmsToMouth(readRms(analyser, buffer))
      value = smoothMouth(value, target)
      return value
    }
  }
}
