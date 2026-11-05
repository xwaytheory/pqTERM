import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  codebuddyProjectSlug,
  ompProjectSlug,
  renderCodebuddySession,
  renderOmpSession
} from './session-native.ts'
import { handoffSeed, transcriptDigest } from './handoff.ts'

const EVENTS = [
  { role: 'user' as const, text: 'Zapamietaj kod 4815' },
  { role: 'assistant' as const, text: 'ok' },
  { role: 'tool' as const, text: 'bash — błąd', failed: true },
  { role: 'user' as const, text: 'Jaki kod podałem?' }
]

test('codebuddy: chained message rows, session id and title in place', () => {
  const rows = renderCodebuddySession({
    id: '11111111-1111-1111-1111-111111111111',
    title: 'pq carry',
    cwd: 'C:\\Users\\pq\\Desktop\\test',
    events: EVENTS
  })
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)

  assert.equal(rows[0].type, 'session-meta')
  assert.equal(rows[1].type, 'ai-title')
  assert.equal(rows[1].aiTitle, 'pq carry')
  const messages = rows.filter((r) => r.type === 'message')
  // prose only: the failed tool row is not a turn the next agent can read
  assert.equal(messages.length, 3)
  assert.equal(messages[0].role, 'user')
  assert.equal(messages[0].parentId, undefined)
  assert.equal(messages[1].parentId, messages[0].id)
  assert.equal(messages[2].parentId, messages[1].id)
  assert.deepEqual((messages[0].content as { type: string }[])[0].type, 'input_text')
  assert.deepEqual((messages[1].content as { type: string }[])[0].type, 'output_text')
  assert.equal(messages[0].sessionId, '11111111-1111-1111-1111-111111111111')
  assert.equal(messages[0].cwd, 'c:\\users\\pq\\desktop\\test')
})

test('omp: header rows first, then a parent chain of prose messages', () => {
  const rows = renderOmpSession({
    id: '22222222-2222-2222-2222-222222222222',
    title: 'pq carry',
    cwd: 'C:\\Users\\pq\\Desktop\\test',
    events: EVENTS
  })
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)

  assert.equal(rows[0].type, 'title')
  assert.equal(rows[1].type, 'session')
  assert.equal(rows[1].id, '22222222-2222-2222-2222-222222222222')
  const messages = rows.filter((r) => r.type === 'message')
  assert.equal(messages.length, 3)
  const second = messages[1].message as { role: string; content: { text: string }[] }
  assert.equal(second.role, 'assistant')
  assert.equal(second.content[0].text, 'ok')
  assert.equal(messages[2].parentId, messages[1].id)
})

test('project slugs match what the CLIs already write on disk', () => {
  assert.equal(
    codebuddyProjectSlug('C:\\Users\\pq\\Desktop\\test'),
    'c-users-pq-desktop-test'
  )
  assert.equal(
    ompProjectSlug('C:\\Users\\pq\\Desktop\\test', 'C:\\Users\\pq'),
    '-Desktop-test'
  )
  // the bridge and tests hand out forward slashes; a leftover `C:` in a folder
  // name makes mkdir fail on Windows, which silently disabled the omp import
  assert.equal(ompProjectSlug('C:/Users/pq/Desktop/test', 'C:\\Users\\pq'), '-Desktop-test')
  // outside home the drive is dropped: a `:` would make the folder invalid
  assert.equal(ompProjectSlug('D:\\work\\x', 'C:\\Users\\pq'), '-work-x')
})

test('digest keeps the newest turns, one line, within the cap', () => {
  const digest = transcriptDigest(EVENTS, 40)
  assert.match(digest, /Jaki kod podałem\?$/)
  assert.equal(digest.includes('\n'), false)
  assert.ok(digest.length <= 40)
  assert.equal(transcriptDigest([]), '')
})

test('seed carries the digest inline when the target cannot import', () => {
  const seed = handoffSeed({
    checkpointPath: 'C:/x/checkpoint.1.md',
    sourceEngine: 'codebuddy',
    targetEngine: 'hermes',
    digest: transcriptDigest([{ role: 'user', text: 'kod 4815' }])
  })
  assert.match(seed, /Dotychczasowa rozmowa: U: kod 4815/)
  assert.equal(seed.includes('\n'), false)
})
