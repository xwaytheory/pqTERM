import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { resolveProfileState } from './profile-state.ts'

test('a new profile stays empty even when the old pq profile is on disk', () => {
  const dir = join('C:', 'Users', 'pq', 'AppData', 'Roaming', 'pqTERM-pr')
  const asked: string[] = []
  const file = resolveProfileState(dir, (path) => {
    asked.push(path)
    return path.replace(/\\/g, '/').endsWith('/pq/pq-state.json')
  })
  assert.equal(file, null)
  assert.deepEqual(asked, [join(dir, 'pq-state.json')])
})

test('an existing profile file is the only one that loads', () => {
  const dir = join('C:', 'Users', 'pq', 'AppData', 'Roaming', 'pqTERM-pr')
  const own = join(dir, 'pq-state.json')
  assert.equal(resolveProfileState(dir, (path) => path === own), own)
})
