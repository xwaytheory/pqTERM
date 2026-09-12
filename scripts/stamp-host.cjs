const { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs')
const { join } = require('path')
const { spawnSync } = require('child_process')

const root = join(__dirname, '..')
const dist = join(root, 'node_modules', 'electron', 'dist')
const srcExe = join(dist, 'electron.exe')
const rcedit = join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe')
const pathTxt = join(root, 'node_modules', 'electron', 'path.txt')
const host = join(root, 'host')
const hostExe = join(host, 'pq.exe')
const distExe = join(dist, 'pq.exe')

if (!existsSync(srcExe)) {
  console.error('[pq] host binary missing — npm install first')
  process.exit(1)
}
if (!existsSync(rcedit)) {
  console.error('[pq] rcedit missing')
  process.exit(1)
}

function stamp(exe) {
  const args = [
    exe,
    '--set-version-string', 'ProductName', 'pq',
    '--set-version-string', 'FileDescription', 'pq',
    '--set-version-string', 'InternalName', 'pq',
    '--set-version-string', 'OriginalFilename', 'pq.exe',
    '--set-version-string', 'CompanyName', 'pq',
    '--set-version-string', 'LegalCopyright', 'pq',
    '--set-product-version', '1.1.0',
    '--set-file-version', '1.1.0'
  ]
  const r = spawnSync(rcedit, args, { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('stamp failed for ' + exe)
}

function pathIsPq() {
  try {
    return readFileSync(pathTxt, 'utf8').trim() === 'pq.exe'
  } catch {
    return false
  }
}

mkdirSync(host, { recursive: true })

const hostNeedsDist = !existsSync(join(host, 'ffmpeg.dll')) || !existsSync(hostExe)
if (hostNeedsDist) {
  cpSync(dist, host, {
    recursive: true,
    filter: (src) => {
      const base = src.split(/[/\\]/).pop()
      return base !== 'electron.exe' && base !== 'pq.exe'
    }
  })
  copyFileSync(srcExe, hostExe)
}

stamp(hostExe)

try {
  copyFileSync(hostExe, distExe)
} catch (err) {
  console.log('[pq] dist/pq.exe locked —', err instanceof Error ? err.message : err)
}

try {
  writeFileSync(pathTxt, 'pq.exe')
} catch (err) {
  console.log('[pq] path.txt locked —', err instanceof Error ? err.message : err)
}

if (!pathIsPq()) {
  console.error('[pq] failed to point host at pq.exe')
  process.exit(1)
}

try {
  stamp(srcExe)
} catch {
  console.log('[pq] live electron.exe locked — pq.exe stamped')
}

console.log('[pq] host stamped →', hostExe)
console.log('[pq] dev host →', distExe)
