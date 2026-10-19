import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(scriptDirectory, '..')
const viteEntry = path.join(projectDirectory, 'node_modules', 'vite', 'bin', 'vite.js')
const configuredUrl = (process.env.TALK_AI_DESKTOP_API_URL || 'http://101.35.54.118').trim()

let apiUrl
try {
  apiUrl = new URL(configuredUrl)
} catch {
  console.error('TALK_AI_DESKTOP_API_URL must be a valid absolute URL.')
  process.exit(1)
}

if (!['http:', 'https:'].includes(apiUrl.protocol)) {
  console.error('TALK_AI_DESKTOP_API_URL must use http or https.')
  process.exit(1)
}

const result = spawnSync(process.execPath, [viteEntry, 'build'], {
  cwd: projectDirectory,
  env: {
    ...process.env,
    VITE_API_BASE_URL: apiUrl.toString().replace(/\/$/, '')
  },
  stdio: 'inherit',
  shell: false
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
