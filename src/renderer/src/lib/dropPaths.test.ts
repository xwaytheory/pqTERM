import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { quotePath, formatDroppedPaths, pathShellForPane } from './dropPaths.ts'

describe('quotePath cmd/pwsh', () => {
  it('leaves simple paths unquoted', () => {
    assert.equal(quotePath('C:\\Users\\admin\\file.txt'), 'C:\\Users\\admin\\file.txt')
  })

  it('quotes paths with spaces using Windows "" escape', () => {
    assert.equal(quotePath('C:\\Users\\admin\\my file.txt'), '"C:\\Users\\admin\\my file.txt"')
  })

  it('doubles embedded quotes for cmd', () => {
    assert.equal(quotePath('C:\\a\\"b".txt'), '"C:\\a\\""b"".txt"')
  })

  it('quotes UNC paths with spaces', () => {
    assert.equal(
      quotePath('\\\\server\\share\\my folder\\x.txt'),
      '"\\\\server\\share\\my folder\\x.txt"'
    )
  })

  it('quotes paths with cmd metacharacters', () => {
    assert.equal(quotePath('C:\\a&b.txt'), '"C:\\a&b.txt"')
  })

  it('quotes paths with percent and caret', () => {
    assert.equal(quotePath('C:\\a%PATH%.txt'), '"C:\\a%PATH%.txt"')
    assert.equal(quotePath('C:\\a^b.txt'), '"C:\\a^b.txt"')
  })

  it('trims and returns empty for blank', () => {
    assert.equal(quotePath('   '), '')
  })
})

describe('quotePath posix', () => {
  it('single-quotes spaces', () => {
    assert.equal(quotePath('/home/user/my file', 'posix'), "'/home/user/my file'")
  })
})

describe('formatDroppedPaths', () => {
  it('joins with trailing space', () => {
    assert.equal(
      formatDroppedPaths(['C:\\a.txt', 'C:\\b c.txt']),
      'C:\\a.txt "C:\\b c.txt" '
    )
  })

  it('filters empty and returns empty when none', () => {
    assert.equal(formatDroppedPaths(['', '  ']), '')
  })

  it('handles UNC + quotes mix', () => {
    const out = formatDroppedPaths(['\\\\srv\\share\\f.txt', 'C:\\q\\"x".dat'])
    assert.equal(out, '\\\\srv\\share\\f.txt "C:\\q\\""x"".dat" ')
  })

  it('quotes percent and caret edges in joined output', () => {
    assert.equal(
      formatDroppedPaths(['C:\\x%Y%.txt', 'C:\\a^b.txt']),
      '"C:\\x%Y%.txt" "C:\\a^b.txt" '
    )
  })
})

describe('pathShellForPane', () => {
  it('defaults Windows agent panes to cmd', () => {
    assert.equal(pathShellForPane({ engine: 'grok' }), 'cmd')
    assert.equal(pathShellForPane({ engine: null }), 'cmd')
  })

  it('maps shell engine to pwsh', () => {
    assert.equal(pathShellForPane({ engine: 'shell' }), 'pwsh')
  })

  it('honors hostType when present (WSL/posix hook)', () => {
    assert.equal(pathShellForPane({ engine: 'shell', hostType: 'wsl' }), 'posix')
    assert.equal(pathShellForPane({ engine: 'grok', hostType: 'posix' }), 'posix')
    assert.equal(pathShellForPane({ engine: 'grok', hostType: 'pwsh' }), 'pwsh')
  })
})

describe('formatDroppedPaths shell-aware', () => {
  it('posix-quotes spaces when shell=posix', () => {
    assert.equal(
      formatDroppedPaths(['/home/u/my file'], 'posix'),
      "'/home/u/my file' "
    )
  })
})

describe('pathShellForPane ENGINE_SPECS matrix contract', () => {
  // Keep in sync with ENGINE_SPECS ids (src/main/engines.ts) and docs/DND-ENGINE-MATRIX.md
  const engines = [
    'grok',
    'omp',
    'hermes',
    'opencode',
    'codex',
    'claude',
    'qwen',
    'dsh',
    'gemini',
    'crush',
    'aider',
    'copilot',
    'shell'
  ] as const

  it('pwsh only for shell; all other engines → cmd', () => {
    for (const engine of engines) {
      const expected = engine === 'shell' ? 'pwsh' : 'cmd'
      assert.equal(pathShellForPane({ engine }), expected, engine)
    }
  })
})
