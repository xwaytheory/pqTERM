// new-work.cjs — one task = one worktree = one branch.
// Usage:
//   node scripts/new-work.cjs create <branch>   create instances/<branch> beside repo.git
//   node scripts/new-work.cjs list              list active worktrees
//   node scripts/new-work.cjs remove <branch>   remove the worktree (keeps the branch)
const { spawnSync } = require('child_process')
const { existsSync } = require('fs')
const { dirname, join, resolve } = require('path')

const root = join(__dirname, '..')
const trees = join(dirname(resolve(root, git('rev-parse', '--git-common-dir'))), 'instances')

function git(...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) {
    console.error('[new-work] git failed:', (r.stderr || r.stdout || '').trim())
    process.exit(r.status ?? 1)
  }
  return (r.stdout || '').trim()
}

function validBranch(name) {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(name) && !name.includes('..')
}

function cmdList() {
  const out = git('worktree', 'list', '--porcelain')
  const entries = []
  let cur = {}
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.path) entries.push(cur)
      cur = { path: line.slice(9) }
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).replace('refs/heads/', '')
    } else if (line === 'bare') {
      cur.bare = true
    }
  }
  if (cur.path) entries.push(cur)
  for (const e of entries) console.log(`${e.bare ? '(bare)' : e.branch || '(detached)'}\t${e.path}`)
}

function cmdCreate(name) {
  if (!name || !validBranch(name)) {
    console.error('[new-work] bad branch name (use feat/foo, fix/bar, …)')
    process.exit(1)
  }
  const dir = resolve(join(trees, name))
  if (existsSync(dir)) {
    console.error('[new-work] already exists:', dir)
    process.exit(1)
  }
  git('worktree', 'add', dir, '-b', name)
  console.log('[new-work] ready:', dir)
  console.log('  1. cd /d "' + dir + '" && npm install   (node_modules are per-worktree)')
  console.log('  2. open a pq workspace with cwd = the dir above')
  console.log('  3. when done: review diff, merge to main, then:')
  console.log('     node scripts/new-work.cjs remove ' + name)
}

function cmdRemove(name) {
  if (!name) {
    console.error('[new-work] usage: new-work remove <branch>')
    process.exit(1)
  }
  const dir = resolve(join(trees, name))
  if (!existsSync(dir)) {
    console.error('[new-work] no such worktree:', dir)
    process.exit(1)
  }
  git('worktree', 'remove', '--force', dir)
  git('worktree', 'prune')
  console.log('[new-work] removed:', dir, '(branch kept — delete with: git branch -D ' + name + ')')
}

const [, , cmd, name] = process.argv
if (cmd === 'list') cmdList()
else if (cmd === 'create') cmdCreate(name)
else if (cmd === 'remove') cmdRemove(name)
else {
  console.error('usage: node scripts/new-work.cjs <create|list|remove> [branch]')
  process.exit(1)
}
