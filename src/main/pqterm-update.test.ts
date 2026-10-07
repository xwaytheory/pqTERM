import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import {
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
  formatPending
} from '../../scripts/pqterm-update.cjs'

const root = resolve('pqterm-root')
const dev = join(root, 'instances', 'dev')
const testWt = join(root, 'instances', 'test')
const wip = join(root, 'instances', 'wip')
const feat = join(root, 'instances', 'feat', 'engine-lifecycle')

test('origin accepts only this GitHub repo', () => {
  assert.equal(originOk('https://github.com/xwaytheory/pqTERM.git'), true)
  assert.equal(originOk('git@github.com:xwaytheory/pqTERM.git'), true)
  assert.equal(originOk('https://github.com/other/pqTERM.git'), false)
})

test('worktree list keeps main, dev and test and leaves wip and feat', () => {
  const text = [
    `worktree ${root}`,
    'HEAD abc',
    'branch refs/heads/main',
    '',
    `worktree ${dev}`,
    'HEAD def',
    'branch refs/heads/dev',
    '',
    `worktree ${testWt}`,
    'HEAD ghi',
    'branch refs/heads/test',
    '',
    `worktree ${wip}`,
    'HEAD jkl',
    'branch refs/heads/main',
    '',
    `worktree ${feat}`,
    'HEAD mno',
    'branch refs/heads/feat/engine-lifecycle',
    ''
  ].join('\n')
  const picked = selectWorktrees(parseWorktrees(text), root)
  assert.deepEqual(picked.map((wt) => wt.action), ['ff', 'ff', 'ff', 'skip', 'skip'])
  assert.match(picked[3].reason, /poza main/)
})

test('a single clone updates whatever branch it is on', () => {
  const picked = selectWorktrees([{ path: root, branch: 'main' }], root)
  assert.equal(picked[0].action, 'ff')
})

test('fast-forward only when GitHub is strictly ahead and the tree is clean', () => {
  const entry = { path: root, branch: 'main', action: 'ff', reason: '' }
  const clean = { dirty: false, hasUpstream: true, ahead: 0, behind: 0 }
  assert.equal(planFastForward(entry, { ...clean, behind: 4 }).action, 'ff')
  assert.equal(planFastForward(entry, { ...clean, dirty: true, behind: 4 }).action, 'skip')
  assert.equal(planFastForward(entry, { ...clean, ahead: 1, behind: 2 }).reason, 'historie się rozjechały')
  assert.equal(planFastForward(entry, { ...clean, ahead: 3 }).reason, 'lokalnie nowsze niż GitHub')
  assert.equal(planFastForward(entry, clean).reason, 'aktualne')
  assert.equal(planFastForward(entry, { ...clean, hasUpstream: false, behind: 1 }).action, 'skip')
})

test('install follows the root lockfile, build follows the official tree', () => {
  assert.equal(wantsInstall(['src/main/index.ts']), false)
  assert.equal(wantsInstall(['package-lock.json']), true)
  assert.equal(treeAction(['src/main/index.ts'], true), 'build')
  assert.equal(treeAction(['src/main/index.ts'], false), 'git')
  assert.equal(treeAction(['package.json'], false), 'install')
  assert.equal(treeAction(['package.json'], true), 'rebuild')
  assert.equal(treeAction(['package-lock.json'], true), 'rebuild')
})

test('launch notice names the command only when a fast-forward exists', () => {
  const behind = noticeFromCounts({
    ahead: 0, behind: 2, branch: 'main', version: '1.3.11', remoteVersion: '1.3.11'
  })
  assert.match(behind.text, /2 nowszych commitów/)
  assert.match(behind.text, /pqterm update/)
  const release = noticeFromCounts({
    ahead: 0, behind: 1, branch: 'main', version: '1.3.11', remoteVersion: '1.3.12'
  })
  assert.match(release.text, /1\.3\.12/)
  assert.equal(noticeFromCounts({
    ahead: 2, behind: 0, branch: 'dev', version: '1.3.11', remoteVersion: '1.3.11'
  }), null)
  assert.match(noticeFromCounts({
    ahead: 1, behind: 1, branch: 'main', version: '1.3.11', remoteVersion: '1.3.11'
  }).text, /rozjechała się/)
})

test('PATH gains the shim directory once', () => {
  assert.equal(pathWithBin('', 'C:\\bin'), 'C:\\bin')
  assert.equal(pathWithBin('C:\\Windows', 'C:\\bin'), 'C:\\Windows;C:\\bin')
  assert.equal(pathWithBin('C:\\bin', 'c:\\bin'), 'C:\\bin')
  assert.match(shimBody('C:\\node.exe', 'C:\\pq\\scripts\\pqterm-update.cjs'), /pqterm-update\.cjs/)
})

test('a failed rebuild is remembered as one row', () => {
  const text = formatPending([{ action: 'build', dir: root }])
  assert.deepEqual(parsePending(text), [{ action: 'build', dir: root }])
  assert.deepEqual(parsePending(formatPending([{ action: 'rebuild', dir: root }])), [{ action: 'rebuild', dir: root }])
  assert.deepEqual(parsePending('nope\n'), [])
})
