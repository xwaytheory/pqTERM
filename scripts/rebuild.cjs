const { spawn } = require('child_process')
const { join } = require('path')

const root = join(__dirname, '..')
const bin = join(root, 'node_modules', 'electron-builder', 'install-app-deps.js')
const child = spawn(process.execPath, [bin], { cwd: root, stdio: 'inherit' })
child.on('exit', (code) => {
  if (code) process.exit(code)
  const stamp = spawn(process.execPath, [join(root, 'scripts', 'stamp-host.cjs')], {
    cwd: root,
    stdio: 'inherit'
  })
  stamp.on('exit', (c) => process.exit(c ?? 0))
})
