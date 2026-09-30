const { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } = require('fs')
const { join } = require('path')
const { tmpdir } = require('os')
const { spawnSync } = require('child_process')

const root = join(__dirname, '..')
const dist = join(root, 'node_modules', 'electron', 'dist')
const srcExe = join(dist, 'electron.exe')
const rcedit = join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe')
const pathTxt = join(root, 'node_modules', 'electron', 'path.txt')
const host = join(root, 'host')
const hostExe = join(host, 'pqterm.exe')
const distExe = join(dist, 'pqterm.exe')
// Desktop shortcuts point IconLocation at this exe, so the brand has to live in
// the binary itself — a window icon alone leaves Explorer showing Electron's.
const brandIco = join(root, 'resources', 'brand', 'pq.ico')

if (!existsSync(srcExe)) {
  console.error('[pqTERM] host binary missing — npm install first')
  process.exit(1)
}
if (!existsSync(rcedit)) {
  console.error('[pqTERM] rcedit missing')
  process.exit(1)
}

function findMt() {
  const base = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin')
  let versions = []
  try {
    versions = readdirSync(base).sort().reverse()
  } catch {
    return null
  }
  for (const v of versions) {
    const p = join(base, v, 'x64', 'mt.exe')
    if (existsSync(p)) return p
  }
  return null
}

// A pane is a ConPTY child, so it inherits the app token and cannot be elevated
// on its own: elevation needs ShellExecute runas, which hands back no pty handle.
// The app is the only place 'Run as administrator' can happen — one manifest
// edit, then every shell / CLI in every pane runs at the highest level available.
function elevate(exe, level) {
  const mt = findMt()
  if (!mt) {
    // ponytail: needs the Windows SDK only to stamp; ship electron-builder's
    // win.requestedExecutionLevel (it edits the same manifest) once signing is set up
    console.log('[pqTERM] mt.exe not found (Windows SDK) — panes stay unelevated')
    return
  }
  const xml = join(tmpdir(), `pqterm-manifest-${process.pid}.xml`)
  if (spawnSync(mt, ['-nologo', `-inputresource:${exe};1`, `-out:${xml}`], { stdio: 'inherit' }).status !== 0) {
    console.log('[pqTERM] manifest read failed for ' + exe)
    return
  }
  const before = readFileSync(xml, 'utf8')
  const hit = before.match(/<requestedExecutionLevel\b[^>]*\blevel="([^"]*)"/)
  if (!hit) {
    console.log('[pqTERM] no requestedExecutionLevel in ' + exe)
    return
  }
  if (hit[1] !== level) {
    writeFileSync(xml, before.replace(hit[0], hit[0].replace(hit[1], level)))
    if (spawnSync(mt, ['-nologo', '-manifest', xml, `-outputresource:${exe};#1`], { stdio: 'inherit' }).status !== 0) {
      console.log('[pqTERM] manifest write failed for ' + exe)
    }
  }
}

function stamp(exe) {
  const args = [
    exe,
    ...(existsSync(brandIco) ? ['--set-icon', brandIco] : []),
    '--set-version-string', 'ProductName', 'pqTERM',
    '--set-version-string', 'FileDescription', 'pqTERM',
    '--set-version-string', 'InternalName', 'pqterm',
    '--set-version-string', 'OriginalFilename', 'pqterm.exe',
    '--set-version-string', 'CompanyName', 'pqTERM',
    '--set-version-string', 'LegalCopyright', 'pq',
    '--set-product-version', '1.3.12',
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

// The delivery binary runs elevated so every pane is Administrator; the dev copy
// stays asInvoker because `npm run dev` spawns it from node, and CreateProcess on
// a gated exe fails with EACCES. Both levels are stamped explicitly, so a re-run
// over an already-elevated host cannot leak the gate into the dev copy.
elevate(hostExe, 'highestAvailable')
elevate(distExe, 'asInvoker')

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
elevate(srcExe, 'asInvoker')

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
