#!/usr/bin/env node
/**
 * Validate the exported Live2D runtime package.
 *
 * Usage (from AI/):
 *   node scripts/check-live2d-assets.mjs
 *   node scripts/check-live2d-assets.mjs --allow-missing
 *
 * Checks:
 * - model3.json exists and references existing files
 * - .moc3 starts with the MOC3 signature
 * - textures are PNG, power-of-two, <= 4096
 * - physics/pose/motion/expression JSON files parse
 * - no absolute paths or ".." in references
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modelArgument = process.argv.find(argument => argument.startsWith('--model='))?.slice('--model='.length)
const MODEL_JSON = modelArgument
  ? path.resolve(process.cwd(), modelArgument)
  : path.join(AI_ROOT, 'public', 'live2d', 'xilian', 'xilian.model3.json')
const MODEL_DIR = path.dirname(MODEL_JSON)
const allowMissing = process.argv.includes('--allow-missing')

const errors = []
const warnings = []

function fail(message) {
  errors.push(message)
}

function warn(message) {
  warnings.push(message)
}

function isSafeRelative(value) {
  if (typeof value !== 'string' || !value) return false
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\')) return false
  return !value.split(/[\\/]/).includes('..')
}

function pngSize(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  }
}

function resolveRef(ref) {
  if (!isSafeRelative(ref)) {
    fail(`unsafe path: ${ref}`)
    return null
  }
  return path.join(MODEL_DIR, ref)
}

function requireFile(ref, label) {
  const full = resolveRef(ref)
  if (!full) return null
  if (!fs.existsSync(full)) {
    fail(`${label} missing: ${ref}`)
    return null
  }
  return full
}

function parseJson(ref, label) {
  const full = requireFile(ref, label)
  if (!full) return null
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'))
  } catch (error) {
    fail(`${label} is not valid JSON (${ref}): ${error.message}`)
    return null
  }
}

if (!fs.existsSync(MODEL_JSON)) {
  const message = `model3.json not found: ${path.relative(AI_ROOT, MODEL_JSON)}`
  if (allowMissing) {
    console.log(`SKIP: ${message}`)
    process.exit(0)
  }
  console.error(`FAIL: ${message}`)
  console.error('Export the model from Cubism Editor into AI/public/live2d/xilian/ first.')
  process.exit(2)
}

let model
try {
  model = JSON.parse(fs.readFileSync(MODEL_JSON, 'utf8'))
} catch (error) {
  console.error(`FAIL: model3.json is not valid JSON: ${error.message}`)
  process.exit(1)
}

if (model.Version !== 3) warn(`model3.json Version is ${model.Version}, expected 3`)

const refs = model.FileReferences || {}
if (!refs.Moc) fail('FileReferences.Moc is missing')
else {
  const mocPath = requireFile(refs.Moc, 'Moc')
  if (mocPath) {
    const header = fs.readFileSync(mocPath).subarray(0, 4).toString('ascii')
    if (header !== 'MOC3') fail(`Moc does not start with MOC3: ${refs.Moc}`)
  }
}

const textures = Array.isArray(refs.Textures) ? refs.Textures : []
if (!textures.length) fail('FileReferences.Textures is empty')
textures.forEach((ref, index) => {
  const full = requireFile(ref, `texture[${index}]`)
  if (!full) return
  const size = pngSize(fs.readFileSync(full))
  if (!size) {
    fail(`texture[${index}] is not a PNG: ${ref}`)
    return
  }
  const pow2 = value => (value & (value - 1)) === 0
  if (!pow2(size.width) || !pow2(size.height)) fail(`texture[${index}] is not power-of-two: ${size.width}x${size.height}`)
  if (size.width > 4096 || size.height > 4096) fail(`texture[${index}] exceeds 4096: ${size.width}x${size.height}`)
})

if (refs.Physics) parseJson(refs.Physics, 'Physics')
if (refs.Pose) parseJson(refs.Pose, 'Pose')
if (refs.UserData) parseJson(refs.UserData, 'UserData')

if (Array.isArray(refs.Expressions)) {
  refs.Expressions.forEach((expression, index) => {
    if (!expression?.File) {
      fail(`Expressions[${index}].File is missing`)
      return
    }
    parseJson(expression.File, `expression[${index}]`)
  })
}

if (refs.Motions && typeof refs.Motions === 'object') {
  for (const [group, motions] of Object.entries(refs.Motions)) {
    if (!Array.isArray(motions)) {
      fail(`Motions.${group} is not an array`)
      continue
    }
    motions.forEach((motion, index) => {
      if (!motion?.File) fail(`Motions.${group}[${index}].File is missing`)
      else parseJson(motion.File, `motion ${group}[${index}]`)
    })
  }
}

const groups = Array.isArray(model.Groups) ? model.Groups : []
const groupNames = new Set(groups.map(group => group.Name))
for (const required of ['EyeBlink', 'LipSync']) {
  if (!groupNames.has(required)) fail(`Groups.${required} is missing`)
}

if (!Array.isArray(model.HitAreas) || model.HitAreas.length === 0) warn('HitAreas is empty')
else {
  model.HitAreas.forEach((hitArea, index) => {
    if (!hitArea?.Id || !hitArea?.Name) fail(`HitAreas[${index}] needs Id and Name`)
  })
}

if (warnings.length) {
  console.log('Warnings:')
  for (const warning of warnings) console.log(`  - ${warning}`)
}
if (errors.length) {
  console.error('Errors:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
console.log(`OK: ${textures.length} texture(s), ${Object.keys(refs.Motions || {}).length} motion group(s), ${refs.Expressions?.length || 0} expression(s)`)
