const { spawn } = require('child_process')
const { join } = require('path')

const root = join(__dirname, '..')
const bin = join(root, 'node_modules', 'electron-builder', 'install-app-deps.js')
const child = spawn(process.execPath, [bin], { cwd: root, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
