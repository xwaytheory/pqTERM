import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handoffSeed } from './handoff.ts'

test('seed names the checkpoint by absolute path and the source engine', () => {
  const seed = handoffSeed({
    checkpointPath: 'C:\\Users\\pq\\AppData\\Local\\pqTERM-dev\\sessions\\s1\\checkpoint.1.md',
    sourceEngine: 'opencode',
    targetEngine: 'codebuddy'
  })
  assert.match(seed, /po opencode/)
  assert.match(seed, /checkpoint\.1\.md/)
  assert.match(seed, /git status/)
})

test('seed is a single line — a TUI paste must not submit per line', () => {
  const seed = handoffSeed({ checkpointPath: 'C:/x/checkpoint.1.md', sourceEngine: 'omp', targetEngine: 'opencode' })
  assert.equal(seed.includes('\n'), false)
})

test('a degraded source is called out so the next agent verifies instead of trusting', () => {
  const seed = handoffSeed({
    checkpointPath: 'C:/x/checkpoint.1.md',
    sourceEngine: 'codebuddy',
    targetEngine: 'opencode',
    degraded: 'degraded'
  })
  assert.match(seed, /niepełny \(degraded\)/)
})
