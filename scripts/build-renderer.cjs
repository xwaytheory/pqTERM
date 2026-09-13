const { spawnSync, spawn } = require('child_process')
const { join } = require('path')

const root = join(__dirname, '..')
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const watch = process.argv[2] === 'watch'

const args = [vite, watch ? '' : 'build', '--config', 'pq.renderer.vite.config.ts'].filter(Boolean)

if (watch) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' })
  child.on('exit', (code) => process.exit(code ?? 0))
} else {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  process.exit(r.status ?? 0)
}