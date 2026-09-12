import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { letterFromName, markForEngine } from './engineMarkLetter.ts'

describe('letterFromName', () => {
  it('takes first alphanumeric', () => {
    assert.equal(letterFromName('Grok CLI'), 'G')
    assert.equal(letterFromName('  omp'), 'O')
    assert.equal(letterFromName('123x'), '1')
  })
  it('falls back for empty', () => {
    assert.equal(letterFromName(''), '?')
    assert.equal(letterFromName('***'), '?')
  })
})

describe('markForEngine', () => {
  it('disambiguates colliding first letters', () => {
    assert.equal(markForEngine('claude', 'Claude Code'), 'Cl')
    assert.equal(markForEngine('codex', 'Codex'), 'Cx')
    assert.equal(markForEngine('crush', 'Crush'), 'Cr')
    assert.equal(markForEngine('copilot', 'Copilot CLI'), 'Co')
    assert.equal(markForEngine('grok', 'Grok CLI'), 'Gr')
    assert.equal(markForEngine('gemini', 'Gemini CLI'), 'Ge')
    assert.equal(markForEngine('omp', 'Omp'), 'Om')
    assert.equal(markForEngine('opencode', 'OpenCode'), 'Oc')
  })
  it('uses explicit mark and single letter otherwise', () => {
    assert.equal(markForEngine('shell', 'PowerShell', 'PS'), 'PS')
    assert.equal(markForEngine('hermes', 'Hermes'), 'H')
  })
})
