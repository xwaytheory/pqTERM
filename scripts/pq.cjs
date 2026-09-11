const { spawn } = require('child_process')
const { join } = require('path')

const root = join(__dirname, '..')
const bin = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const child = spawn(process.execPath, [bin, ...process.argv.slice(2), '-c', 'pq.vite.config.ts'], {
  cwd: root,
  stdio: 'inherit'
})
child.on('exit', (code) => process.exit(code ?? 0))
