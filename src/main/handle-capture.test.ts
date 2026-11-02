import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { captureCodebuddyHandle, pickCodebuddySession } from './handle-capture.ts'

test('the entry published under our pid wins over a newer foreign one', () => {
  const entries = [
    { pid: 100, sessionId: 'ours', cwd: 'C:/work', startedAt: 1000 },
    { pid: 200, sessionId: 'theirs', cwd: 'C:/work', startedAt: 5000 }
  ]
  assert.equal(pickCodebuddySession(entries, 100, 'C:/work', 0), 'ours')
})

test('without a pid match, only sessions started after the pane qualify', () => {
  const entries = [
    { pid: 7, sessionId: 'old', cwd: 'C:/work', startedAt: 100 },
    { pid: 8, sessionId: 'fresh', cwd: 'C:/work', startedAt: 900 }
  ]
  assert.equal(pickCodebuddySession(entries, 999, 'C:/work', 500), 'fresh')
})

test('another directory is never adopted', () => {
  const entries = [{ pid: 9, sessionId: 'other', cwd: 'C:/elsewhere', startedAt: 900 }]
  assert.equal(pickCodebuddySession(entries, 999, 'C:/work', 0), null)
})

test('capture reads the registry file for the pid', (t) => {
  const home = mkdtempSync(join(os.tmpdir(), 'pq-cb-'))
  t.mock.method(os, 'homedir', () => home)
  syncBuiltinESMExports()
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    rmSync(home, { recursive: true, force: true })
  })
  const dir = join(home, '.codebuddy', 'sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, '4242.json'),
    JSON.stringify({ pid: 4242, sessionId: 'sess-xyz', cwd: 'C:/work', startedAt: 10 }),
    'utf8'
  )
  assert.equal(captureCodebuddyHandle(4242, 'C:/work', 0), 'sess-xyz')
  // unknown pid + a session older than this pane must not be adopted
  assert.equal(captureCodebuddyHandle(1, 'C:/work', 1000), null)
})
