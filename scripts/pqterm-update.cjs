const { spawnSync } = require('child_process')
const { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } = require('fs')
const { homedir } = require('os')
const { dirname, join, relative, resolve } = require('path')

// Daily copies follow GitHub. wip keeps its index; feat/* stays isolated.
const DAILY = new Map([
  ['.', 'main'],
  ['instances/dev', 'dev'],
  ['instances/test', 'test']
])

function originOk(url) {
  const u = String(url || '').trim().replace(/\/+$/, '').replace(/\.git$/, '')
  return /github\.com[:/]xwaytheory\/pqTERM$/i.test(u)
}

function parseWorktrees(text) {
  const out = []
  let cur = null
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur)
      cur = { path: line.slice('worktree '.length).trim(), branch: null }
    } else if (cur && line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim()
      cur.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
    }
  }
  if (cur) out.push(cur)
  return out
}

function normRel(root, target) {
  const rel = relative(resolve(root), resolve(target)).replace(/\\/g, '/')
  return rel === '' ? '.' : rel
}

function selectWorktrees(list, stableRoot) {
  if (list.length <= 1) return list.map((wt) => ({ ...wt, action: 'ff', reason: '' }))
  return list.map((wt) => {
    const expected = DAILY.get(normRel(stableRoot, wt.path).toLowerCase())
    if (!expected) return { ...wt, action: 'skip', reason: 'poza main/dev/test' }
    if (wt.branch !== expected) {
      return { ...wt, action: 'skip', reason: `gałąź ${wt.branch || 'detached'}, oczekiwano ${expected}` }
    }
    return { ...wt, action: 'ff', reason: '' }
  })
}

function planFastForward(entry, gitState) {
  if (entry.action === 'skip') return entry
  if (!entry.branch) return { ...entry, action: 'skip', reason: 'detached HEAD' }
  if (gitState.dirty) return { ...entry, action: 'skip', reason: 'lokalne zmiany — nic nie ruszam' }
  if (!gitState.hasUpstream) return { ...entry, action: 'skip', reason: `brak origin/${entry.branch}` }
  const ahead = gitState.ahead || 0
  const behind = gitState.behind || 0
  if (ahead > 0 && behind > 0) return { ...entry, action: 'skip', reason: 'historie się rozjechały' }
  if (behind === 0) {
    return { ...entry, action: 'skip', reason: ahead > 0 ? 'lokalnie nowsze niż GitHub' : 'aktualne' }
  }
  return { ...entry, action: 'ff', reason: '', behind }
}

function wantsInstall(files) {
  return files.some((f) => {
    const n = String(f).replace(/\\/g, '/')
    return n === 'package.json' || n === 'package-lock.json'
  })
}

// ponytail: any commit on the official tree triggers a full build, even docs-only — split when build time hurts
function treeAction(files, isAppRoot) {
  if (wantsInstall(files)) return isAppRoot ? 'rebuild' : 'install'
  if (isAppRoot) return 'build'
  return 'git'
}

function noticeFromCounts({ ahead, behind, branch, version, remoteVersion }) {
  if (!(behind > 0)) return null
  if (ahead > 0) {
    return { text: `Ta kopia rozjechała się z GitHub (${branch}). pqterm update jej nie zaktualizuje.` }
  }
  const ver = remoteVersion && version && remoteVersion !== version
    ? `Jest wersja ${remoteVersion} (tu ${version}). `
    : ''
  const commits = behind === 1 ? '1 nowszy commit' : `${behind} nowszych commitów`
  return {
    text: `${ver}GitHub ma ${commits} (${branch}). Zamknij pqTERM i w cmd wpisz: pqterm update`
  }
}

function pathWithBin(current, bin) {
  const parts = String(current || '').split(';').map((s) => s.trim()).filter(Boolean)
  if (parts.some((p) => p.toLowerCase() === bin.toLowerCase())) return current
  if (!current) return bin
  return String(current).replace(/;+\s*$/, '') + ';' + bin
}

function shimBody(node, script) {
  return `@echo off\r\n"${node}" "${script}" %*\r\n`
}

function parsePending(text) {
  return String(text || '').split(/\r?\n/).map((line) => {
    const tab = line.indexOf('\t')
    if (tab < 1) return null
    const action = line.slice(0, tab)
    const dir = line.slice(tab + 1).trim()
    if ((action !== 'install' && action !== 'build' && action !== 'rebuild') || !dir) return null
    return { action, dir }
  }).filter(Boolean)
}

function formatPending(rows) {
  return rows.map((r) => `${r.action}\t${r.dir}`).join('\n') + (rows.length ? '\n' : '')
}

const PENDING_TEXT = 'Aktualizacja została przerwana przed przebudową. Zamknij pqTERM i w cmd wpisz: pqterm update'

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || `git ${args.join(' ')}`).trim())
  return (r.stdout || '').replace(/\s+$/, '')
}

function stableRoot(from) {
  const common = git(from, ['rev-parse', '--git-common-dir'])
  return dirname(resolve(from, common))
}

function readVersion(cwd) {
  try {
    return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version || ''
  } catch {
    return ''
  }
}

function pendingFile() {
  const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  return join(base, 'pqTERM', 'rebuild.txt')
}

function readPending() {
  try {
    return parsePending(readFileSync(pendingFile(), 'utf8'))
  } catch {
    return []
  }
}

function writePending(rows) {
  const file = pendingFile()
  if (!rows.length) {
    try { unlinkSync(file) } catch { /* already gone */ }
    return
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, formatPending(rows))
}

function samePath(a, b) {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase()
}

// ponytail: rebuild.txt jest współdzielony — obce kopii (np. sandbox w Temp) obsłuży tylko jej własny update
function inTree(stable, dir) {
  return !normRel(stable, dir).startsWith('..')
}

// ponytail: image-name filter only — a host launched via electron.exe (dev/rebuild)
// would otherwise skip the lock check; check both possible image names.
function pqtermRunning() {
  if (process.platform !== 'win32') return false
  for (const image of ['pqterm.exe', 'electron.exe']) {
    const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'], {
      encoding: 'utf8',
      windowsHide: true
    })
    if (new RegExp(`\\b${image}\\b`, 'i').test(r.stdout || '')) return true
  }
  return false
}

function npmBin() {
  if (process.platform !== 'win32') return 'npm'
  const r = spawnSync('where.exe', ['npm.cmd'], { encoding: 'utf8', windowsHide: true })
  const line = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean)
  if (line) return line
  const fallback = join(homedir(), 'AppData', 'Roaming', 'npm', 'npm.cmd')
  return existsSync(fallback) ? fallback : 'npm.cmd'
}

// cmd splits a shell line at the first unquoted space, so npm.cmd found in
// "C:\Program Files\nodejs" on the client machine ran as "C:\Program". Only the
// program path needs quoting today (args are simple words: install/run/build),
// a marker so spaced arguments would have to be quoted here.
const quoteForShell = (s) => (/[\s"]/.test(s) ? `"${s}"` : s)

function runCmd(file, args, cwd) {
  // Node ≥21 refuses bare .cmd/.bat in spawnSync (CVE-2024-27980) — route through the shell
  const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)
  const r = spawnSync(viaShell ? quoteForShell(file) : file, args, { cwd, stdio: 'inherit', windowsHide: true, shell: viaShell })
  if (r.error) throw r.error
  if (r.status) throw new Error(`${file} ${args.join(' ')} zakończył się kodem ${r.status}`)
}

function inspect(entry) {
  // -uno: untracked files don't block a ff-merge (git still refuses to overwrite them)
  const dirty = git(entry.path, ['status', '--porcelain', '-uno']).length > 0
  let hasUpstream = false
  try {
    git(entry.path, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${entry.branch}`])
    hasUpstream = true
  } catch {
    hasUpstream = false
  }
  let ahead = 0
  let behind = 0
  if (hasUpstream && entry.branch) {
    const parts = git(entry.path, ['rev-list', '--left-right', '--count', `HEAD...origin/${entry.branch}`])
      .split(/\s+/)
      .map(Number)
    ahead = parts[0] || 0
    behind = parts[1] || 0
  }
  return { dirty, hasUpstream, ahead, behind }
}

function changedFiles(cwd, branch) {
  const out = git(cwd, ['diff', '--name-only', `HEAD...origin/${branch}`])
  if (!out) return []
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
}

function findNode() {
  const base = require('path').basename(process.execPath).toLowerCase()
  if (process.env.ELECTRON_RUN_AS_NODE !== '1' && base.startsWith('node')) return process.execPath
  if (process.platform !== 'win32') return 'node'
  const r = spawnSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true })
  return (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) || ''
}

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

function readUserPath() {
  const r = spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    "[Environment]::GetEnvironmentVariable('Path','User')"
  ], { encoding: 'utf8', windowsHide: true })
  if (r.status) throw new Error((r.stderr || 'nie dało się odczytać PATH').toString().trim())
  return (r.stdout || '').replace(/\r?\n$/, '')
}

function writeUserPath(value) {
  const r = spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `[Environment]::SetEnvironmentVariable('Path', ${psQuote(value)}, 'User')`
  ], { windowsHide: true })
  if (r.status) throw new Error('nie dało się zapisać PATH')
}

function ensureCmd() {
  if (process.platform !== 'win32') return 0
  const selfRoot = join(__dirname, '..')
  let stable = selfRoot
  try { stable = stableRoot(selfRoot) } catch { /* this folder is the install */ }
  const atStable = join(stable, 'scripts', 'pqterm-update.cjs')
  const script = existsSync(atStable) ? atStable : join(selfRoot, 'scripts', 'pqterm-update.cjs')
  const node = findNode()
  if (!node) {
    process.stderr.write('[pqterm] brak node.exe w PATH — komenda pqterm nie została dodana\n')
    return 0
  }
  const bin = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'pqTERM', 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'pqterm.cmd'), shimBody(node, script))
  try {
    const cur = readUserPath()
    const next = pathWithBin(cur, bin)
    if (next !== cur) writeUserPath(next)
  } catch (err) {
    process.stderr.write(`[pqterm] PATH bez zmian: ${err instanceof Error ? err.message : err}\n`)
  }
  return 0
}

function followsGitHub(root) {
  const stable = stableRoot(root)
  const listed = parseWorktrees(git(root, ['worktree', 'list', '--porcelain']))
  const mine = selectWorktrees(listed, stable).find((wt) => samePath(wt.path, root))
  return Boolean(mine && mine.action === 'ff')
}

function check() {
  const root = join(__dirname, '..')
  let notice = null
  try {
    if (!followsGitHub(root)) throw new Error('skip')
    const url = git(root, ['remote', 'get-url', 'origin'])
    if (!originOk(url)) throw new Error('origin')
    const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (!branch || branch === 'HEAD') throw new Error('detached')
    git(root, ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
    const parts = git(root, ['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`])
      .split(/\s+/)
      .map(Number)
    let remoteVersion = ''
    try {
      remoteVersion = JSON.parse(git(root, ['show', `origin/${branch}:package.json`])).version || ''
    } catch { /* version line is optional */ }
    notice = noticeFromCounts({
      ahead: parts[0] || 0,
      behind: parts[1] || 0,
      branch,
      version: readVersion(root),
      remoteVersion
    })
  } catch {
    notice = null
  }
  if (!notice) {
    let own = root
    try { own = stableRoot(root) } catch { /* this folder is the install */ }
    if (readPending().some((row) => inTree(own, row.dir))) notice = { text: PENDING_TEXT }
  }
  process.stdout.write(JSON.stringify({ notice }) + '\n')
  return 0
}

function finishTree(dir, action, pending) {
  const rest = pending.filter((row) => !samePath(row.dir, dir))
  // remember the job BEFORE building — a killed build recovers on the next run
  writePending(rest.concat([{ action, dir }]))
  try {
    if (action === 'install' || action === 'rebuild') {
      console.log(`[pqterm] npm install w ${dir}`)
      runCmd(npmBin(), ['install'], dir)
    }
    if (action === 'build' || action === 'rebuild') {
      console.log(`[pqterm] przebudowuję ${dir}`)
      runCmd(npmBin(), ['run', 'build'], dir)
    }
    writePending(rest)
    return { pending: rest, ok: true }
  } catch (err) {
    console.error(`[pqterm] ${err instanceof Error ? err.message : err}`)
    return { pending: rest.concat([{ action, dir }]), ok: false }
  }
}

function update() {
  const root = join(__dirname, '..')
  let url
  try {
    url = git(root, ['remote', 'get-url', 'origin'])
  } catch {
    console.error('[pqterm] to nie jest kopia git albo nie ma git w PATH')
    return 1
  }
  if (!originOk(url)) {
    console.error(`[pqterm] origin to nie jest github.com/xwaytheory/pqTERM (${url})`)
    return 1
  }
  let stable
  try {
    stable = stableRoot(root)
  } catch (err) {
    console.error('[pqterm]', err instanceof Error ? err.message : err)
    return 1
  }
  console.log('[pqterm] pobieram z GitHuba')
  try {
    git(root, ['fetch', 'origin', '+refs/heads/*:refs/remotes/origin/*', '--prune'])
  } catch (err) {
    console.error('[pqterm]', err instanceof Error ? err.message : err)
    return 1
  }
  let selected
  try {
    const listed = parseWorktrees(git(root, ['worktree', 'list', '--porcelain']))
    selected = selectWorktrees(listed, stable)
  } catch (err) {
    console.error('[pqterm]', err instanceof Error ? err.message : err)
    return 1
  }
  const single = selected.length <= 1
  const running = pqtermRunning()
  // ponytail: rebuild.txt jest współdzielony — wiersze obcych kopii zachowujemy
  // dla ich własnego update'a, worktreey tej kopii (main/dev/test) przetwarzamy,
  // resztę (stale ścieżki) wywalamy
  const foreign = []
  let pending = []
  const rows = readPending()
  for (const row of rows) {
    if (!inTree(stable, row.dir)) foreign.push(row)
    else if (selected.some((e) => samePath(e.path, row.dir))) pending.push(row)
  }
  if (pending.length + foreign.length !== rows.length) writePending(foreign.concat(pending))
  let failed = false
  let locked = false
  const queued = []

  for (const entry of selected) {
    const label = `${entry.path} (${entry.branch || 'detached'})`
    if (entry.action === 'skip') {
      console.log(`[pqterm] ${label} — pomijam: ${entry.reason}`)
      continue
    }
    let plan
    try {
      plan = planFastForward(entry, inspect(entry))
    } catch (err) {
      console.error(`[pqterm] ${label} — ${err instanceof Error ? err.message : err}`)
      failed = true
      continue
    }
    const appRoot = single || samePath(entry.path, stable)
    const remembered = pending.find((row) => samePath(row.dir, entry.path))
    if (plan.action !== 'ff') {
      if (remembered) {
        if (running) {
          console.log(`[pqterm] ${label} — pomijam: zamknij pqTERM i uruchom jeszcze raz (została przebudowa)`)
          locked = true
        } else {
          const act = remembered.action === 'install' && appRoot ? 'rebuild' : remembered.action
          queued.push({ dir: entry.path, action: act })
        }
      } else console.log(`[pqterm] ${label} — ${plan.reason}`)
      continue
    }
    let files = []
    try {
      files = changedFiles(entry.path, entry.branch)
    } catch (err) {
      console.error(`[pqterm] ${label} — ${err instanceof Error ? err.message : err}`)
      failed = true
      continue
    }
    let action = treeAction(files, appRoot)
    if (remembered?.action === 'install') action = appRoot ? 'rebuild' : 'install'
    else if (remembered?.action === 'rebuild') action = 'rebuild'
    if (running && action !== 'git') {
      console.log(`[pqterm] ${label} — pomijam: zamknij pqTERM i uruchom jeszcze raz (trzeba przebudować)`)
      locked = true
      continue
    }
    try {
      git(entry.path, ['merge', '--ff-only', `origin/${entry.branch}`])
      console.log(`[pqterm] ${label} — dociągnięte ${plan.behind}`)
    } catch (err) {
      console.error(`[pqterm] ${label} — ${err instanceof Error ? err.message : err}`)
      failed = true
      continue
    }
    if (action !== 'git') queued.push({ dir: entry.path, action })
  }

  for (const job of queued) {
    const result = finishTree(job.dir, job.action, pending)
    pending = result.pending
    if (!result.ok) failed = true
  }
  if (foreign.length) writePending(foreign.concat(pending))
  if (failed) return 1
  if (locked) {
    console.log('[pqterm] część kopii czeka. Zamknij pqTERM i wpisz jeszcze raz: pqterm update')
    return 2
  }
  console.log('[pqterm] gotowe')
  return 0
}

function main() {
  const arg = process.argv[2]
  if (arg === '--ensure-cmd') return ensureCmd()
  if (arg === '--check') return check()
  if (arg === 'update') return update()
  console.log('pqterm update   — pobiera main, dev i test z GitHuba i przebudowuje oficjalną kopię')
  return 0
}

module.exports = {
  originOk,
  parseWorktrees,
  selectWorktrees,
  planFastForward,
  wantsInstall,
  treeAction,
  noticeFromCounts,
  pathWithBin,
  shimBody,
  parsePending,
  formatPending,
  inTree,
  quoteForShell,
  PENDING_TEXT
}

if (require.main === module) process.exit(main())
