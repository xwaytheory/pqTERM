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

test('kitty OSC 99 keeps the message and picks up a title from the metadata', () => {
  const [a] = scanOscNotices('\x1b]99;title=claude:task=1;Task complete\x07')
  assert.deepEqual(a, [{ title: 'claude', body: 'Task complete' }])
  const [b] = scanOscNotices('\x1b]99;Needs input\x1b\\')
  assert.deepEqual(b, [{ title: '', body: 'Needs input' }])
})

test('the Warp CLI-agent payload becomes a readable toast, not raw JSON', () => {
  const warp = (event: Record<string, unknown>): string =>
    `\x1b]777;notify;warp://cli-agent;${JSON.stringify(event)}\x07`
  const [asked] = scanOscNotices(warp({ event: 'question_asked', summary: 'Waiting for your answer', agent: 'omp' }))
  assert.deepEqual(asked, [{ title: 'omp', body: 'Waiting for your answer' }])
  const [perm] = scanOscNotices(warp({ event: 'permission_request', tool_name: 'Bash', agent: 'omp' }))
  assert.deepEqual(perm, [{ title: 'omp', body: 'Prośba o zgodę na Bash' }])
  const [stop] = scanOscNotices(warp({ event: 'stop', response: 'Done — 3 files changed', agent: 'hermes' }))
  assert.deepEqual(stop, [{ title: 'hermes', body: 'Done — 3 files changed' }])
  const [fail] = scanOscNotices(warp({ event: 'stop_failure', error_type: 'aborted', agent: 'omp' }))
  assert.deepEqual(fail, [{ title: 'omp', body: 'Przerwane: aborted' }])
})

test('an unknown Warp event or broken JSON falls back to the raw fields', () => {
  const [a] = scanOscNotices('\x1b]777;notify;warp://cli-agent;{"event":"session_start"}\x07')
  assert.deepEqual(a, [{ title: 'warp://cli-agent', body: '{"event":"session_start"}' }])
  const [b] = scanOscNotices('\x1b]777;notify;warp://cli-agent;{not json\x07')
  assert.deepEqual(b, [{ title: 'warp://cli-agent', body: '{not json' }])
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
