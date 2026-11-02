import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickActiveTitle } from './db-title.ts'

test('pickActiveTitle returns the most recently updated title for matching cwd', () => {
  const rows = [
    { directory: 'C:/Users/pq/pq', title: 'Stary session', time_updated: 500 },
    { directory: 'C:/Users/pq/pq', title: 'Dodanie freebuff i Kimi Code do Spawn Engine', time_updated: 1000 },
    { directory: 'C:/Users/pq/pq-term', title: 'Inny katalog', time_updated: 900 }
  ]
  assert.equal(pickActiveTitle(rows, 'C:/Users/pq/pq'), 'Dodanie freebuff i Kimi Code do Spawn Engine')
})

test('pickActiveTitle normalises backslashes', () => {
  const rows = [{ directory: 'C:/Users/pq/pq', title: 'T', time_updated: 1 }]
  assert.equal(pickActiveTitle(rows, 'C:\\Users\\pq\\pq'), 'T')
})

test('pickActiveTitle returns null when no rows match', () => {
  assert.equal(pickActiveTitle([], 'C:/Users/pq/pq'), null)
  assert.equal(pickActiveTitle([{ directory: 'C:/other', title: 'T', time_updated: 1 }], 'C:/Users/pq/pq'), null)
})

test('pickActiveTitle reads opencode session-list rows and worktree cwds', () => {
  const rows = [
    { directory: 'C:/Users/pq/pqTERM', title: 'stary', updated: 100 },
    { directory: 'C:/Users/pq/pqTERM', title: 'nowy', updated: 400 }
  ]
  assert.equal(pickActiveTitle(rows, 'C:/Users/pq/pqTERM/instances/dev'), 'nowy')
  assert.equal(pickActiveTitle(rows, 'C:/Users/pq/other'), null)
})

test('pickActiveTitle skips rows with empty or missing title', () => {
  const rows = [
    { directory: 'C:/d', title: '', time_updated: 100 },
    { directory: 'C:/d', title: '   ', time_updated: 90 },
    { directory: 'C:/d', time_updated: 80 },
    { directory: 'C:/d', title: 'Valid', time_updated: 50 }
  ]
  assert.equal(pickActiveTitle(rows, 'C:/d'), 'Valid')
})