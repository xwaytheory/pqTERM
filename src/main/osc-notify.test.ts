import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanOscNotices, cleanNoticeText } from './osc-notify.ts'

test('OSC 9 notification with BEL and ST terminators', () => {
  const [a] = scanOscNotices('\x1b]9;Task complete\x07')
  assert.deepEqual(a, [{ title: '', body: 'Task complete' }])
  const [b] = scanOscNotices('\x1b]9;Needs input\x1b\\')
  assert.deepEqual(b, [{ title: '', body: 'Needs input' }])
})

test('OSC 777 notify;title;body parses both fields', () => {
  const [a] = scanOscNotices('\x1b]777;notify;freebuff;Waiting for your review\x07')
  assert.deepEqual(a, [{ title: 'freebuff', body: 'Waiting for your review' }])
})

test('titles and plain OSC 0/2 are not mistaken for notifications', () => {
  const [a] = scanOscNotices('\x1b]0;opencode: fix the grid\x07\x1b]2;freebuff: main*\x07')
  assert.deepEqual(a, [])
})

test('a sequence split across chunks is assembled via the kept tail', () => {
  const [, keep1] = scanOscNotices('hello \x1b]9;Task half')
  assert.ok(keep1.startsWith('\x1b]9;'))
  const [a] = scanOscNotices(keep1 + ' done\x07next output')
  assert.deepEqual(a, [{ title: '', body: 'Task half done' }])
})

test('multiple notifications in one chunk all fire', () => {
  const [a] = scanOscNotices('\x1b]9;one\x07text\x1b]777;notify;t;two\x07')
  assert.deepEqual(a, [
    { title: '', body: 'one' },
    { title: 't', body: 'two' }
  ])
})

test('unterminated pathological garbage is dropped, not kept forever', () => {
  const [, keep] = scanOscNotices('\x1b]9;' + 'x'.repeat(4096))
  assert.equal(keep, '')
})

test('cleanNoticeText strips control characters and collapses whitespace', () => {
  // ESC itself becomes a space per the cleaner contract; SGR payloads remain
  // (CLI authors send plain text in notifications — this only guards toasts
  // from raw control bytes).
  assert.equal(cleanNoticeText('done\x07 with \x1b[32mcolor'), 'done with [32mcolor')
  assert.equal(cleanNoticeText('  a\r\n\nb  '), 'a b')
})
