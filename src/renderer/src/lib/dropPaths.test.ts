import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { quotePath, formatDroppedPaths } from './dropPaths.ts'

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
})
