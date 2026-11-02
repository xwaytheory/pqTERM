import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { listCheckpoints, renderCheckpoint, writeCheckpoint, type CheckpointInput } from './ledger.ts'

const base = (): CheckpointInput => ({
  sessionId: 'sess-1',
  engine: 'opencode',
  handle: 'ses_abc',
  cwd: 'C:/work',
  now: Date.parse('2026-11-02T20:00:00Z'),
  transcript: {
    status: 'ok',
    events: [
      { role: 'user', text: 'napraw testy' },
      { role: 'tool', text: 'bash — błąd', failed: true },
      { role: 'assistant', text: 'Zrobione, 3 pliki.' },
      { role: 'user', text: 'a teraz build' }
    ]
  },
  changes: [' M src/main/resume.ts']
})

test('checkpoint carries provenance the next agent can judge', () => {
  const md = renderCheckpoint(base())
  assert.match(md, /pq-checkpoint v1/)
  assert.match(md, /engine: opencode/)
  assert.match(md, /handle: ses_abc/)
  assert.match(md, /transcript: ok/)
  assert.match(md, /events: 4/)
  assert.match(md, /natywnego transkryptu/)
})

test('checkpoint shows the newest user turn and the newest finished answer', () => {
  const md = renderCheckpoint(base())
  assert.match(md, /## Ostatnia prośba użytkownika\n\na teraz build/)
  assert.match(md, /## Ostatnia ukończona odpowiedź\n\nZrobione, 3 pliki\./)
  assert.match(md, /- bash — błąd/)
  assert.match(md, / M src\/main\/resume\.ts/)
})

test('a degraded transcript is labelled, not silently trusted', () => {
  const md = renderCheckpoint({
    ...base(),
    transcript: { status: 'degraded', reason: 'CLI timeout', events: [] }
  })
  assert.match(md, /transcript: degraded \(CLI timeout\)/)
  assert.match(md, /Transkrypt niepełny/)
  assert.match(md, /_\(brak w transkrypcie\)_/)
})

test('a quota death is stated in the checkpoint, not hidden', () => {
  const md = renderCheckpoint({
    ...base(),
    transcript: { status: 'ok', error: 'Free usage limit reached.', events: [{ role: 'user', text: 'x' }] }
  })
  assert.match(md, /## Błąd ostatniej tury/)
  assert.match(md, /Free usage limit reached\./)
})

test('checkpoints are append-only per session', () => {
  const root = mkdtempSync(join(os.tmpdir(), 'pq-ledger-'))
  try {
    const first = writeCheckpoint(root, base())
    const second = writeCheckpoint(root, { ...base(), transcript: { status: 'empty', events: [] } })
    assert.ok(first && second)
    assert.match(first, /checkpoint\.1\.md$/)
    assert.match(second, /checkpoint\.2\.md$/)
    assert.equal(listCheckpoints(root, 'sess-1').length, 2)
    assert.match(readFileSync(first, 'utf8'), /a teraz build/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a broken artifact root degrades to null instead of throwing', () => {
  const root = mkdtempSync(join(os.tmpdir(), 'pq-ledger-'))
  const file = join(root, 'not-a-dir')
  writeFileSync(file, 'x')
  try {
    assert.equal(writeCheckpoint(file, base()), null)
    assert.deepEqual(listCheckpoints(file, 'sess-1'), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
