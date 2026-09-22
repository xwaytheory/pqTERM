import assert from 'node:assert/strict'
import test from 'node:test'
import { appendTail } from './term-stream.ts'

test('short buffers are returned untouched', () => {
  assert.equal(appendTail('abc', 'def', 32), 'abcdef')
})

test('a cut landing inside a CSI is moved past its final byte', () => {
  // keep 6 of 'lead\x1b[31mred' -> the cut sits on '3', inside SGR 31m
  const out = appendTail('', 'lead\x1b[31mred', 6)
  assert.equal(out, 'red')
  assert.ok(!/^[0-9;]*m/.test(out), 'replay must not start mid-sequence')
})

test('a cut inside an OSC title is moved past its terminator', () => {
  const out = appendTail('', 'aa\x1b]0;pq\x07tail', 8)
  assert.equal(out, 'tail')
})

test('a cut inside plain text keeps the plain character cut', () => {
  assert.equal(appendTail('', 'aaaaaaaaaa', 4), 'aaaa')
})

test('a cut on a complete sequence boundary keeps that sequence', () => {
  // 9 kept characters start exactly on the escape
  assert.equal(appendTail('', 'lead\x1b[31mred', 8), '\x1b[31mred')
})

test('a surrogate pair is never split', () => {
  assert.equal(appendTail('', `${'x'.repeat(10)}🙂`, 1), '🙂')
})

test('the tail never exceeds the cap and keeps the newest bytes', () => {
  const out = appendTail('', `${'a'.repeat(400)}\x1b[0m${'b'.repeat(20)}`, 30)
  assert.ok(out.length <= 30)
  assert.ok(out.endsWith('b'.repeat(20)))
})
