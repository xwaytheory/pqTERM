import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DEFAULTS_END, DEFAULTS_START, seedWorkspaceDefaults } from './trust.ts'

test('seedWorkspaceDefaults writes AGENTS.md and CLAUDE.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pq-seed-'))
  seedWorkspaceDefaults(dir)
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8')
  assert.ok(agents.includes(DEFAULTS_START))
  assert.ok(agents.includes('Ponytail'))
  assert.ok(agents.includes('i-have-adhd'))
  assert.ok(agents.includes(DEFAULTS_END))
  assert.equal(agents, claude)
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

