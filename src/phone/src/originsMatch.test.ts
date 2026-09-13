import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { originsMatch } from './originsMatch.ts'

describe('originsMatch (Android STT contract)', () => {
  it('matches same scheme+authority ignoring path/query', () => {
    assert.equal(
      originsMatch('https://abc.trycloudflare.com/phone?x=1', 'https://abc.trycloudflare.com'),
      true
    )
    assert.equal(
      originsMatch('https://abc.trycloudflare.com/', 'https://abc.trycloudflare.com/app'),
      true
    )
  })

  it('rejects prefix tricks and foreign hosts', () => {
    assert.equal(
      originsMatch('https://abc.trycloudflare.com.evil.example/', 'https://abc.trycloudflare.com'),
      false
    )
    assert.equal(originsMatch('https://evil.example/', 'https://abc.trycloudflare.com'), false)
  })

  it('rejects about:blank and scheme mismatch', () => {
    assert.equal(originsMatch('about:blank', 'https://abc.trycloudflare.com'), false)
    assert.equal(originsMatch('http://abc.trycloudflare.com', 'https://abc.trycloudflare.com'), false)
  })

  it('is case-insensitive on host', () => {
    assert.equal(
      originsMatch('https://ABC.TryCloudflare.com/x', 'https://abc.trycloudflare.com'),
      true
    )
  })
})
