import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(scriptDirectory, '..')
const viteEntry = path.join(projectDirectory, 'node_modules', 'vite', 'bin', 'vite.js')
const electronEntry = path.join(projectDirectory, 'node_modules', 'electron', 'cli.js')
const quiet = process.argv.includes('--quiet')
const log = quiet ? fs.openSync(path.join(projectDirectory, 'desktop-launch.log'), 'a') : null
const stdio = quiet ? ['ignore', log, log] : 'inherit'

const build = spawnSync(process.execPath, [viteEntry, 'build'], {
  cwd: projectDirectory,
  env: { ...process.env, VITE_API_BASE_URL: '' },
  stdio,
  windowsHide: true,
  shell: false
})
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)

// 某些终端会导出 ELECTRON_RUN_AS_NODE=1；此时 electron.exe 会以纯 Node 启动，
// 缺少 Electron 的 snapshot 直接断言崩溃，必须从子进程环境中彻底删除而不是置空。
const appEnv = { ...process.env }
delete appEnv.ELECTRON_RUN_AS_NODE

// Keep hardware acceleration and Chromium's default sandbox enabled.
// Software rendering is an explicit troubleshooting option, not the default.
const appArgs = ['.']
if (process.env.TALK_AI_SOFTWARE_RENDERING === '1') appArgs.push('--disable-gpu')

const app = spawnSync(process.execPath, [electronEntry, ...appArgs], {
  cwd: projectDirectory,
  env: appEnv,
  stdio,
  windowsHide: true,
  shell: false
})
if (app.error) throw app.error
process.exit(app.status ?? 1)
