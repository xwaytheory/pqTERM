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
    return nextResolve(specifier === './resolve-launch' && context.parentURL?.endsWith('/resume.ts')
      ? './resolve-launch.ts' : specifier, context)
  }
`)}`, import.meta.url)
// Dynamic import is required so this test's Node resolution hook is installed first.
const { pickResume, primeResume } = await import('./resume.ts')

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
})
