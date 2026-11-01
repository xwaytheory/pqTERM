#!/usr/bin/env node
/**
 * check-version-sync.cjs — guard for the version bump ritual.
 *
 * Two failure classes it exists for:
 *
 *  1) Product version drifting apart between the places that must agree
 *     (package.json / crates / src-tauri / stamp-host / README / lock entries).
 *
 *  2) A blind search-replace over a Cargo.lock rewriting a *dependency* version.
 *     Real incident (2026-09-15, commit 11b420b): bump 1.1.6 -> 1.1.7 also rewrote
 *     the `toml` crate to `1.1.7+spec-1.1.0`, which does not exist — and every
 *     `cargo` command in src-tauri died at dependency resolution, which silently
 *     froze the whole Tauri track.
 *
 * Usage:  npm run check:version
 * Escape: PQ_VERSION_ALLOW="toml@1.1.7,other@1.1.7" — only for a *verified* real
 *         package that legitimately shares the product version.
 */
const { execFileSync } = require('child_process')
const { existsSync, readFileSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const LOCAL_CRATES = new Set(['pq', 'pq-core', 'pq-work', 'pq-voice'])
// Registry deps that genuinely sit on the product version (checksums verified
// against crates.io via cargo itself).
const STATIC_ALLOWED = [
  'scopeguard@1.2.0',
  'downcast-rs@1.2.1',
  'stable_deref_trait@1.2.1',
  'uds_windows@1.2.1',
  // product 1.5.0 (2026-09-30): real crates.io versions, not a replace scar —
  // `cargo metadata --locked` passes with them, and the bump diff touches only
  // the local crates in each lock. Entries are inert once the product moves on.
  'byteorder@1.5.0',
  'http@1.5.0',
  'lazy_static@1.5.0',
  // product 1.5.1: same story (the 1.5.0 → 1.5.1 bump nearly hit this again —
  // verify the offending package is untouched by the diff before allowing it).
  'autocfg@1.5.1',
  'crc32fast@1.5.1',
  // product 1.7.0: `cargo info blocking@1.7.0` confirms the real crate version;
  // the bump diff touches only the local `pq` crate in src-tauri/Cargo.lock.
  'blocking@1.7.0',
  // product 1.9.0: `cargo info zeroize@1.9.0` confirms the real crate version;
  // the bump diff touches only the local crates in each lock.
  'zeroize@1.9.0'
]
const allowed = new Set([
  ...STATIC_ALLOWED,
  ...String(process.env.PQ_VERSION_ALLOW || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
])

const problems = []
const skipped = []

function read(rel) {
  const file = join(root, rel)
  if (!existsSync(file)) return null
  return readFileSync(file, 'utf8')
}

function readJson(rel) {
  const raw = read(rel)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch (err) {
    problems.push(`${rel}: nie parsuje się jako JSON (${err.message})`)
    return null
  }
}

function grab(rel, re) {
  const raw = read(rel)
  if (raw === null) return null
  const m = raw.match(re)
  return m ? m[1] : null
}

function base(v) {
  return String(v).split('+')[0]
}

function parseLock(rel) {
  const raw = read(rel)
  if (raw === null) return null
  return raw
    .split(/^\[\[package\]\]\r?$/m)
    .slice(1)
    .map((block) => ({
      name: (block.match(/^name = "(.+)"\r?$/m) || [])[1],
      version: (block.match(/^version = "(.+)"\r?$/m) || [])[1],
      registry: /^source = "registry\+/m.test(block)
    }))
    .filter((p) => p.name && p.version)
}

// ---------------------------------------------------------------- product version
const productJson = readJson('package.json')
const product = productJson?.version ?? null
if (!product) {
  problems.push('package.json: brak pola "version"')
}

/** stamp-host niesie wersję albo dosłownie (`--set-product-version', '1.2.3'`),
 *  albo od C12 przez `require('.../package.json').version` — ten kształt jest
 *  z definicji zsynchronizowany z package.json, więc go akceptujemy. Plik bez
 *  żadnej z tych form to problem. */
function stampHostVersion(raw, product) {
  if (raw === null) return null
  const literal = raw.match(/--set-product-version', '([^']+)'/)
  if (literal) return literal[1]
  return raw.includes("'--set-product-version', appVersion") && product ? product : null
}

const places = {
  'package.json': productJson?.version ?? null,
  'package-lock.json (root)': readJson('package-lock.json')?.version ?? null,
  'package-lock.json (packages[""])':
    readJson('package-lock.json')?.packages?.['']?.version ?? null,
  'crates/Cargo.toml': grab('crates/Cargo.toml', /^version = "([^"]+)"/m),
  'src-tauri/Cargo.toml': grab('src-tauri/Cargo.toml', /^version = "([^"]+)"/m),
  'src-tauri/tauri.conf.json': readJson('src-tauri/tauri.conf.json')?.version ?? null,
  'crates/pq-core/src/version.rs': grab(
    'crates/pq-core/src/version.rs',
    /WORKSPACE_VERSION: &str = "([^"]+)"/
  ),
  'scripts/stamp-host.cjs': stampHostVersion(read('scripts/stamp-host.cjs'), product),
  'README.md': grab('README.md', /\*\*Wersja: ([\d.]+)\*\*/)
}

for (const [where, version] of Object.entries(places)) {
  if (version === null) {
    problems.push(`${where}: nie znalazłem wersji produktu`)
    continue
  }
  if (product && version !== product) {
    problems.push(`${where}: ${version} != ${product} (package.json)`)
  }
}

// ------------------------------------------------------------------- cargo locks
const locks = ['crates/Cargo.lock', 'src-tauri/Cargo.lock']
for (const rel of locks) {
  const packages = parseLock(rel)
  if (!packages) {
    skipped.push(`${rel}: brak pliku`)
    continue
  }
  for (const p of packages) {
    if (LOCAL_CRATES.has(p.name)) {
      if (product && p.version !== product) {
        problems.push(`${rel}: lokalny crate ${p.name}=${p.version} != ${product}`)
      }
      continue
    }
    // registry package sitting on exactly the product version — how the `toml`
    // rewrite looked: `version = "1.1.7+spec-1.1.0"` while the checksum stayed
    // the one for 1.1.6
    if (product && p.registry && base(p.version) === base(product)) {
      const key = `${p.name}@${p.version}`
      if (allowed.has(key) || allowed.has(`${p.name}@${base(p.version)}`)) continue
      problems.push(
        `${rel}: zależność ${p.name}=${p.version} ma wersję produktu (${product}) — ` +
          `wygląda jak ślad globalnego replace; sprawdź checksum lub dodaj ` +
          `PQ_VERSION_ALLOW="${key}" jeśli to prawdziwa wersja`
      )
    }
  }
}

// ------------------------------------------- cargo as the oracle for lock sanity
function cargoAvailable() {
  try {
    execFileSync('cargo', ['--version'], { stdio: 'ignore', timeout: 30000 })
    return true
  } catch {
    return false
  }
}

const cargo = cargoAvailable()
if (!cargo) {
  skipped.push('cargo niedostępne — pomijam weryfikację locków przez cargo')
} else {
  for (const dir of ['crates', 'src-tauri']) {
    const cwd = join(root, dir)
    if (!existsSync(join(cwd, 'Cargo.toml'))) {
      skipped.push(`${dir}/Cargo.toml: brak`)
      continue
    }
    const args = ['metadata', '--locked', '--format-version', '1']
    let ok = false
    let tail = ''
    for (const mode of [['--offline'], []]) {
      try {
        execFileSync('cargo', [...args, ...mode], {
          cwd,
          // keep stdout (JSON) quiet but capture stderr: that is where the
          // resolution error that this guard exists for shows up
          stdio: ['ignore', 'ignore', 'pipe'],
          timeout: 180000
        })
        ok = true
        break
      } catch (err) {
        const text = String((err && err.stderr) || err.message || err).trim()
        tail = text
          .split('\n')
          .filter(Boolean)
          .slice(0, 2)
          .join(' ')
      }
    }
    if (!ok) {
      problems.push(`${dir}: cargo metadata --locked nie przechodzi — ${tail}`)
    }
  }
}

// --------------------------------------------------------------------------- report
for (const s of skipped) console.log(`SKIP: ${s}`)
if (problems.length) {
  console.log(`\nFAIL: check-version-sync (${problems.length})`)
  for (const p of problems) console.log(`  - ${p}`)
  console.log('\nwersja produktu:', product)
  process.exit(1)
}
console.log(`OK: check-version-sync (product ${product}; ${locks.length} locki, ${cargo ? 'cargo' : 'bez cargo'})`)
