import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { register, syncBuiltinESMExports } from 'node:module'
import type { Workspace } from '../shared/types.ts'

// The application bundler resolves this extensionless import; native Node needs its extension.
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    return nextResolve(context.parentURL?.endsWith('/resume.ts') && (specifier === './resolve-launch' || specifier === './db-title')
      ? specifier + '.ts' : specifier, context)
  }
`)}`, import.meta.url)
// Dynamic import is required so this test's Node resolution hook is installed first.
const { opencodeRefs, pickResume, primeResume, shouldClearHandle } = await import('./resume.ts')

test('native session claims reserve persisted handles and remain owned across repeated starts', async (t) => {
  const home = mkdtempSync(join(os.tmpdir(), 'pq-resume-'))
  t.mock.method(os, 'homedir', () => home)
  syncBuiltinESMExports()
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    rmSync(home, { recursive: true, force: true })
  })
  const cwd = join(home, 'workspace')
  const dir = join(home, '.omp', 'agent', 'sessions', 'project')
  mkdirSync(dir, { recursive: true })
  for (const [handle, time] of [['reserved', 300], ['fallback', 200], ['spare', 100]] as const) {
    const file = join(dir, `session_${handle}.jsonl`)
    writeFileSync(file, `{}\n${JSON.stringify({ type: 'session', id: handle, cwd })}\n`)
    utimesSync(file, time, time)
  }
  const ws: Workspace = {
    id: 'workspace', title: '', cwd, layout: 3, createdAt: 0, updatedAt: 0,
    panes: [
      { id: 'first', engine: 'omp', title: '' },
      { id: 'owner', engine: 'omp', title: '', sessionHandle: 'reserved' },
      { id: 'duplicate', engine: 'omp', title: '', sessionHandle: 'reserved' }
    ]
  }
  await primeResume([ws], [])

  assert.equal(pickResume(ws.id, 'omp', 'first')?.handle, 'fallback')
  assert.equal(pickResume(ws.id, 'omp', 'first')?.handle, 'fallback')
  assert.equal(pickResume(ws.id, 'omp', 'owner', 'reserved')?.handle, 'reserved')
  assert.equal(pickResume(ws.id, 'omp', 'owner', 'reserved')?.handle, 'reserved')
  assert.equal(pickResume(ws.id, 'omp', 'duplicate', 'reserved')?.handle, 'spare')
  assert.equal(pickResume(ws.id, 'omp', 'duplicate', 'reserved')?.handle, 'spare')
  assert.equal(pickResume(ws.id, 'omp', 'other'), null)
  // store was read: a handle it no longer lists may be dropped
  assert.equal(shouldClearHandle(ws.id, 'omp', 'gone'), true)
})

test('opencode session-list rows match the project root from a worktree cwd', () => {
  const rows = [
    { id: 'ses_a', title: 'starsza', updated: 100, directory: 'C:\\Users\\pq\\pqTERM' },
    { id: 'ses_b', title: 'nowsza', updated: 300, directory: 'C:/Users/pq/pqTERM' },
    { id: 'ses_c', title: 'inny projekt', updated: 900, directory: 'C:/Users/pq/other' }
  ]
  const refs = opencodeRefs(rows, 'C:/Users/pq/pqTERM/instances/dev')
  assert.deepEqual(refs.map((r) => r.handle), ['ses_b', 'ses_a'])
  assert.deepEqual(refs.map((r) => r.title), ['nowsza', 'starsza'])
})

test('opencode rows without an id are dropped, missing directory is trusted', () => {
  assert.deepEqual(opencodeRefs([{ title: 'bez id', updated: 1 }], 'C:/p'), [])
  assert.deepEqual(opencodeRefs([{ id: 'ses_x', updated: 1 }], 'C:/p').map((r) => r.handle), ['ses_x'])
})

test('an engine without a readable store keeps its persisted handle', async (t) => {
  const home = mkdtempSync(join(os.tmpdir(), 'pq-resume-'))
  t.mock.method(os, 'homedir', () => home)
  syncBuiltinESMExports()
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    rmSync(home, { recursive: true, force: true })
  })
  const ws: Workspace = {
    id: 'cb', title: '', cwd: join(home, 'project'), layout: 1, createdAt: 0, updatedAt: 0,
    panes: [{ id: 'pane', engine: 'codebuddy', title: '', sessionHandle: 'abc' }]
  }
  await primeResume([ws], [])
  assert.equal(pickResume(ws.id, 'codebuddy', 'pane', 'abc'), null)
  assert.equal(shouldClearHandle(ws.id, 'codebuddy', 'abc'), false)
})
