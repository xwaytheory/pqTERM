import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DEFAULTS_END, DEFAULTS_START, SEED_FILES, seedWorkspaceDefaults } from './trust.ts'

test('seedWorkspaceDefaults writes instruction files every CLI reads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pq-seed-'))
  seedWorkspaceDefaults(dir)
  const bodies = SEED_FILES.map((rel) => readFileSync(join(dir, rel), 'utf8'))
  for (const body of bodies) {
    assert.ok(body.includes(DEFAULTS_START))
    assert.ok(body.includes('Ponytail'))
    assert.ok(body.includes('i-have-adhd'))
    assert.ok(body.includes(DEFAULTS_END))
  }
  assert.equal(new Set(bodies).size, 1)
})

test('seedWorkspaceDefaults keeps existing notes and stays idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pq-seed-'))
  writeFileSync(join(dir, 'AGENTS.md'), '# existing\n', 'utf8')
  seedWorkspaceDefaults(dir)
  seedWorkspaceDefaults(dir)
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  assert.ok(agents.startsWith('# existing'))
  assert.equal(agents.split(DEFAULTS_START).length - 1, 1)
})

test('seedWorkspaceDefaults skips missing directories', () => {
  seedWorkspaceDefaults(join(tmpdir(), 'pq-seed-missing-' + Date.now()))
})

