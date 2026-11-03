import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canSwitchWithContext, switchTargets } from './engineSwitch.ts'
import type { EngineId, ProviderInfo } from './types.ts'

function provider(id: EngineId, extra: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    id,
    name: id,
    vendor: 'test',
    command: id,
    args: [],
    color: '#fff',
    installed: true,
    actions: [],
    detectedAuth: true,
    enabled: true,
    models: [],
    hint: '',
    ...extra
  }
}

describe('switchTargets', () => {
  it('never offers the engine that is already running', () => {
    const ids = switchTargets(
      [provider('opencode'), provider('hermes'), provider('codebuddy')],
      [],
      'opencode'
    ).map((p) => p.id)
    assert.deepEqual(ids, ['hermes', 'codebuddy'])
  })

  it('drops disabled CLIs but keeps raw shells as a fallback', () => {
    const ids = switchTargets(
      [
        provider('opencode', { enabled: false }),
        provider('hermes'),
        provider('shell', { enabled: false }),
        provider('cmd')
      ],
      [],
      'codebuddy'
    ).map((p) => p.id)
    assert.deepEqual(ids, ['hermes', 'shell', 'cmd'])
  })

  it('puts favourites first in starring order, installed before missing', () => {
    const ids = switchTargets(
      [
        provider('opencode', { installed: false }),
        provider('hermes'),
        provider('kimi'),
        provider('freebuff', { installed: false }),
        provider('shell')
      ],
      ['kimi', 'opencode'],
      'codebuddy'
    ).map((p) => p.id)
    assert.deepEqual(ids, ['kimi', 'opencode', 'hermes', 'freebuff', 'shell'])
  })
})

describe('canSwitchWithContext', () => {
  it('is true only for engines with a transcript adapter', () => {
    assert.equal(canSwitchWithContext('codebuddy'), true)
    assert.equal(canSwitchWithContext('opencode'), true)
    assert.equal(canSwitchWithContext('omp'), true)
    assert.equal(canSwitchWithContext('hermes'), false)
    assert.equal(canSwitchWithContext('shell'), false)
    assert.equal(canSwitchWithContext(null), false)
  })
})
