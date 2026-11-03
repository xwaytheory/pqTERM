import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseOpencodeModels, renderOpencodeSession } from './opencode-session.ts'

const model = { id: 'deepseek-v4.1-flash-free', providerID: 'opencode' }

const events = [
  { role: 'user' as const, text: 'zrób X' },
  { role: 'assistant' as const, text: 'zrobione' },
  { role: 'tool' as const, text: 'shell — błąd', failed: true },
  { role: 'user' as const, text: 'teraz Y' }
]

describe('parseOpencodeModels', () => {
  it('prefers the built-in opencode provider over a third-party line', () => {
    const model = parseOpencodeModels('orcarouter/anthropic/claude-fable-5\nopencode/beam-free\n')
    assert.deepEqual(model, { providerID: 'opencode', id: 'beam-free' })
  })

  it('splits a three-segment id on the first slash only', () => {
    const model = parseOpencodeModels('orcarouter/anthropic/claude-fable-5\n')
    assert.deepEqual(model, { providerID: 'orcarouter', id: 'anthropic/claude-fable-5' })
  })

  it('returns null for an empty or malformed list', () => {
    assert.equal(parseOpencodeModels('no models here\n'), null)
  })
})

describe('renderOpencodeSession', () => {
  it('replays prose turns in order and drops tool noise', () => {
    const doc = JSON.parse(
      renderOpencodeSession({ id: 'ses_test', title: 'zadanie', cwd: 'C:/repo', events, model })
    )
    assert.equal(doc.messages.length, 3)
    assert.deepEqual(
      doc.messages.map((m: { type: string }) => m.type),
      ['user', 'assistant', 'user']
    )
    assert.equal(doc.messages[0].text, 'zrób X')
    assert.equal(doc.messages[1].content[0].text, 'zrobione')
    assert.equal(doc.messages[2].text, 'teraz Y')
  })

  it('keeps the task title and cwd so the session is recognisable in OpenCode', () => {
    const doc = JSON.parse(
      renderOpencodeSession({ id: 'ses_test', title: 'Codebuddy Code czeka na Ciebie', cwd: 'C:/repo', events, model })
    )
    assert.equal(doc.info.title, 'Codebuddy Code czeka na Ciebie')
    assert.equal(doc.info.location.directory, 'C:/repo')
    assert.equal(doc.info.id, 'ses_test')
    assert.equal(doc.info.model.id, 'deepseek-v4.1-flash-free')
    assert.equal(doc.info.model.providerID, 'opencode')
  })

  it('never emits duplicate message ids', () => {
    const doc = JSON.parse(
      renderOpencodeSession({ id: 'ses_test', title: 't', cwd: 'C:/repo', events, model })
    )
    const ids = doc.messages.map((m: { id: string }) => m.id)
    assert.equal(new Set(ids).size, ids.length)
  })
})
