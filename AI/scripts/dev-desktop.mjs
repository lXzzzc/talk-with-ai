import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(scriptDirectory, '..')
const tauriEntry = path.join(projectDirectory, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const configuredUrl = (process.env.TALK_AI_DESKTOP_API_URL || 'http://101.35.54.118').trim()
const localBackend = process.argv.includes('--local')

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

const child = spawn(process.execPath, [tauriEntry, 'dev', ...process.argv.slice(2).filter(arg => arg !== '--local')], {
  cwd: projectDirectory,
  env: {
    ...process.env,
    VITE_API_BASE_URL: localBackend ? '' : apiUrl.toString().replace(/\/$/, '')
  },
  stdio: 'inherit',
  shell: false
})

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
