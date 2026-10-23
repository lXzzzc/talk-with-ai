import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(scriptDirectory, '..')
const viteEntry = path.join(projectDirectory, 'node_modules', 'vite', 'bin', 'vite.js')
const builderEntry = path.join(projectDirectory, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
const pkg = JSON.parse(fs.readFileSync(path.join(projectDirectory, 'package.json'), 'utf8'))
const outputDirectory = path.resolve(projectDirectory, '..', 'releases', pkg.version)
if (fs.existsSync(outputDirectory)) {
  const archive = path.resolve(projectDirectory, '..', 'releases', 'history', `${pkg.version}-${Date.now()}`)
  fs.mkdirSync(path.dirname(archive), { recursive: true })
  fs.renameSync(outputDirectory, archive)
}
fs.mkdirSync(outputDirectory, { recursive: true })
// NSIS executes its intermediate uninstaller during packaging. If the output
// inherits the workspace's Low integrity label, that process cannot write to
// the normal user temp directory. Correct generated artifacts BEFORE building.
if (process.platform === 'win32') {
  const label = spawnSync('icacls', [outputDirectory, '/setintegritylevel', '(OI)(CI)M', '/T', '/C'], {
    stdio: 'ignore', windowsHide: true, shell: false
  })
  if (label.status !== 0) throw new Error('Unable to prepare the release directory integrity level')
}
const buildTemp = path.join(process.env.LOCALAPPDATA || projectDirectory, 'XilianAI', 'build-temp')
fs.mkdirSync(buildTemp, { recursive: true })
const tempProbe = path.join(buildTemp, `write-check-${process.pid}.tmp`)
fs.writeFileSync(tempProbe, 'ok')
fs.unlinkSync(tempProbe)
const buildEnvironment = { ...process.env, TEMP: buildTemp, TMP: buildTemp }

const build = spawnSync(process.execPath, [viteEntry, 'build'], {
  cwd: projectDirectory,
  env: { ...process.env, VITE_API_BASE_URL: '' },
  stdio: 'inherit',
  windowsHide: true,
  shell: false
})
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)

const bundleArgs = [builderEntry, '--win', '--x64', `--config.directories.output=${outputDirectory}`]
if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
  const runtime = path.resolve(process.env.ELECTRON_OVERRIDE_DIST_PATH)
  const runtimeVersion = fs.readFileSync(path.join(runtime, 'version'), 'utf8').trim().replace(/^v/, '')
  if (runtimeVersion !== pkg.devDependencies.electron) throw new Error(`Electron version mismatch: ${runtimeVersion}`)
  bundleArgs.push(`--config.electronDist=${runtime}`)
}
const bundle = spawnSync(process.execPath, bundleArgs, {
  cwd: projectDirectory,
  env: buildEnvironment,
  stdio: 'inherit',
  windowsHide: true,
  shell: false
})
if (bundle.error) throw bundle.error
if (bundle.status !== 0) process.exit(bundle.status ?? 1)

// Codex/DSH 工作区里的文件带 Low 完整性标签，从这里双击 exe 会以低完整性运行，
// 无法写入 %TEMP%，NSIS 会报 “Error writing temporary file”。打包后把产物提升到 Medium。
spawnSync('icacls', [outputDirectory, '/setintegritylevel', 'Medium', '/T', '/C'], {
  stdio: 'ignore',
  windowsHide: true,
  shell: false
})

process.exit(0)
