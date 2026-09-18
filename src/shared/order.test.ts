import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moveId, reorderByIds } from './order.ts'

test('moveId inserts before and after without dropping ids', () => {
  assert.deepEqual(moveId(['a', 'b', 'c'], 'c', 'a', 'before'), ['c', 'a', 'b'])
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', 'c', 'after'), ['b', 'c', 'a'])
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', 'b', 'after'), ['b', 'a', 'c'])
})

test('moveId is identity for self, missing, or unknown ids', () => {
  assert.deepEqual(moveId(['a', 'b'], 'a', 'a', 'after'), ['a', 'b'])
  assert.deepEqual(moveId(['a', 'b'], 'z', 'a', 'before'), ['a', 'b'])
  assert.deepEqual(moveId(['a', 'b'], 'a', 'z', 'after'), ['a', 'b'])
})

test('reorderByIds follows permutation and keeps leftovers', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(reorderByIds(items, ['c', 'a', 'b']).map((x) => x.id), ['c', 'a', 'b'])
  assert.deepEqual(reorderByIds(items, ['b']).map((x) => x.id), ['b', 'a', 'c'])
  assert.deepEqual(reorderByIds(items, ['x', 'c', 'c']).map((x) => x.id), ['c', 'a', 'b'])
  assert.equal(reorderByIds(items, []), items)
})
