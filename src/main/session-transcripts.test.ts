import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codebuddyTranscript, ompTranscript, opencodeTranscript } from './session-transcripts.ts'

test('opencode export keeps user turns, finished answers and failed tools', () => {
  const raw = {
    info: { id: 'ses_1' },
    messages: [
      { type: 'user', text: 'zrób build', time: { created: 1 } },
      { type: 'assistant', content: [{ type: 'text', text: 'Buduję.' }], time: { created: 2, completed: 3 } },
      { type: 'tool', name: 'bash', state: { status: 'error' } },
      { type: 'idle' }
    ]
  }
  const out = opencodeTranscript(raw)
  // idle is a terminator, not an unknown row — a normal export must read as ok
  assert.equal(out.status, 'ok')
  assert.deepEqual(
    out.events.map((e) => e.role),
    ['user', 'assistant', 'tool']
  )
  assert.equal(out.events[2].failed, true)
})

test('a turn killed by the free-tier limit is recorded as the handoff reason', () => {
  const raw = {
    messages: [
      { type: 'user', text: 'dokończ refactor' },
      {
        type: 'assistant',
        content: [],
        finish: 'error',
        error: { type: 'provider.free-limit', message: 'Free usage limit reached.' }
      },
      { type: 'idle' }
    ]
  }
  const out = opencodeTranscript(raw)
  assert.equal(out.status, 'ok')
  assert.equal(out.error, 'Free usage limit reached.')
  assert.deepEqual(out.events.map((e) => e.role), ['user'])
})

test('opencode export without messages is schemaUnknown, never a crash', () => {
  assert.equal(opencodeTranscript({ info: {} }).status, 'schemaUnknown')
  assert.equal(opencodeTranscript(null).status, 'schemaUnknown')
})

test('omp jsonl ignores session headers and maps turns', () => {
  const jsonl = [
    JSON.stringify({ type: 'title', title: 'x' }),
    JSON.stringify({ type: 'session', id: 'abc', cwd: 'C:/w' }),
    JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hej' }] } }),
    JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'no hej' }] } }),
    JSON.stringify({ type: 'message', message: { role: 'toolResult', toolName: 'bash', isError: true, content: [] } })
  ].join('\n')
  const out = ompTranscript(jsonl)
  assert.equal(out.status, 'degraded')
  assert.deepEqual(out.events.map((e) => e.role), ['user', 'assistant', 'tool'])
  assert.equal(out.events[2].failed, true)
})

test('codebuddy jsonl maps messages and tool results, skips bookkeeping rows', () => {
  const jsonl = [
    JSON.stringify({ type: 'session-meta', sessionId: 's' }),
    JSON.stringify({ type: 'message', role: 'user', content: 'kontynuuj' }),
    JSON.stringify({ type: 'message', role: 'assistant', content: 'ok' }),
    JSON.stringify({ type: 'function_call_result', name: 'Bash', output: { isError: true } }),
    JSON.stringify({ type: 'ai-title', aiTitle: 'tytuł' })
  ].join('\n')
  const out = codebuddyTranscript(jsonl)
  assert.equal(out.status, 'degraded')
  assert.deepEqual(out.events.map((e) => e.role), ['user', 'assistant', 'tool'])
})

test('empty or unparseable input reports empty, not ok', () => {
  assert.equal(ompTranscript('').status, 'empty')
  assert.equal(codebuddyTranscript('{not json}').status, 'empty')
})
