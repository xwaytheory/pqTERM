const { copyFileSync, existsSync, mkdirSync } = require('fs')
const { join } = require('path')
const { spawnSync } = require('child_process')

const root = join(__dirname, '..')
const src = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const rcedit = join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe')

if (!existsSync(src)) {
  console.error('[pq] host binary missing — npm install first')
  process.exit(1)
}
if (!existsSync(rcedit)) {
  console.error('[pq] rcedit missing')
  process.exit(1)
}

const dir = join(root, 'host')
mkdirSync(dir, { recursive: true })
const pqExe = join(dir, 'pq.exe')
copyFileSync(src, pqExe)

function stamp(exe) {
  const args = [
    exe,
    '--set-version-string', 'ProductName', 'pq',
    '--set-version-string', 'FileDescription', 'pq',
    '--set-version-string', 'InternalName', 'pq',
    '--set-version-string', 'OriginalFilename', 'pq.exe',
    '--set-version-string', 'CompanyName', 'pq',
    '--set-version-string', 'LegalCopyright', 'pq',
    '--set-product-version', '0.1.0',
    '--set-file-version', '0.1.0'
  ]
  const r = spawnSync(rcedit, args, { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('stamp failed for ' + exe)
}

stamp(pqExe)
try {
  stamp(src)
} catch {
  console.log('[pq] live host locked — pq.exe stamped')
}
console.log('[pq] host stamped')
