const { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } = require('fs')
const { join } = require('path')
const { spawnSync } = require('child_process')

const root = join(__dirname, '..')
const dist = join(root, 'node_modules', 'electron', 'dist')
const srcExe = join(dist, 'electron.exe')
const rcedit = join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe')
const pathTxt = join(root, 'node_modules', 'electron', 'path.txt')
const host = join(root, 'host')
const hostExe = join(host, 'pqterm.exe')
const distExe = join(dist, 'pqterm.exe')

if (!existsSync(srcExe)) {
  console.error('[pqTERM] host binary missing — npm install first')
  process.exit(1)
}
if (!existsSync(rcedit)) {
  console.error('[pqTERM] rcedit missing')
  process.exit(1)
}

function stamp(exe) {
  const args = [
    exe,
    '--set-version-string', 'ProductName', 'pqTERM',
    '--set-version-string', 'FileDescription', 'pqTERM',
    '--set-version-string', 'InternalName', 'pqterm',
    '--set-version-string', 'OriginalFilename', 'pqterm.exe',
    '--set-version-string', 'CompanyName', 'pqTERM',
    '--set-version-string', 'LegalCopyright', 'pq',
    '--set-product-version', '1.2.0',
    '--set-file-version', '1.1.7'
  ]
  const r = spawnSync(rcedit, args, { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('stamp failed for ' + exe)
}

function pathIsPq() {
  try {
    return readFileSync(pathTxt, 'utf8').trim() === 'pqterm.exe'
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
      return base !== 'electron.exe' && base !== 'pq.exe' && base !== 'pqterm.exe'
    }
  })
  copyFileSync(srcExe, hostExe)
}
// one-time cleanup of the pre-rebrand host binary
for (const legacy of [join(host, 'pq.exe'), join(dist, 'pq.exe')]) {
  try {
    if (existsSync(legacy)) unlinkSync(legacy)
  } catch {
    /* locked — leave it, harmless */
  }
}

stamp(hostExe)

try {
  copyFileSync(hostExe, distExe)
} catch (err) {
  console.log('[pqTERM] dist/pqterm.exe locked —', err instanceof Error ? err.message : err)
}

try {
  writeFileSync(pathTxt, 'pqterm.exe')
} catch (err) {
  console.log('[pqTERM] path.txt locked —', err instanceof Error ? err.message : err)
}

if (!pathIsPq()) {
    console.error('[pqTERM] failed to point host at pqterm.exe')
  process.exit(1)
}

try {
  stamp(srcExe)
} catch {
  console.log('[pqTERM] live electron.exe locked — pqterm.exe stamped')
}

// Bare `host\pqterm.exe` (double-click, no argv) must boot pqTERM — not Electron's
// demo. Link host/resources/app -> project root (its package.json points at
// out/), same layout START-prod.cmd uses via argv.
try {
  const resDir = join(host, 'resources')
  const link = join(resDir, 'app')
  mkdirSync(resDir, { recursive: true })
  let st = null
  try {
    st = lstatSync(link)
  } catch {
    st = null
  }
  if (st && st.isSymbolicLink()) {
    try {
      unlinkSync(link)
    } catch {
      st = { keep: true }
    }
    if (!st.keep) st = null
  }
  if (!st) {
    symlinkSync(root, link, 'junction')
    console.log('[pqTERM] host app link →', link)
  } else {
    console.log('[pqTERM] host app link present — skipped')
  }
} catch (err) {
  console.log('[pqTERM] app link skipped —', err instanceof Error ? err.message : err)
}

console.log('[pqTERM] host stamped →', hostExe)
console.log('[pqTERM] dev host →', distExe)
