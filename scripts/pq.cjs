const { spawn, spawnSync } = require('child_process')
const { existsSync, readFileSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const pathTxt = join(root, 'node_modules', 'electron', 'path.txt')
const distPq = join(root, 'node_modules', 'electron', 'dist', 'pq.exe')
let hostName = ''
try {
  hostName = readFileSync(pathTxt, 'utf8').trim()
} catch {
  hostName = ''
}
if (!existsSync(distPq) || hostName !== 'pq.exe') {
  const stamped = spawnSync(process.execPath, [join(root, 'scripts', 'stamp-host.cjs')], {
    cwd: root,
    stdio: 'inherit'
  })
  if (stamped.status) process.exit(stamped.status)
}

const bin = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const child = spawn(process.execPath, [bin, ...process.argv.slice(2), '-c', 'pq.vite.config.ts'], {
  cwd: root,
  stdio: 'inherit'
})
child.on('exit', (code) => process.exit(code ?? 0))
