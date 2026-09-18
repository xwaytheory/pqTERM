import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isHttpUrl } from './httpUrl.ts'

test('isHttpUrl allows http(s) and rejects about/file/junk', () => {
  assert.equal(isHttpUrl('https://github.com/xwaytheory/pq'), true)
  assert.equal(isHttpUrl('http://example.com/a'), true)
  assert.equal(isHttpUrl('about:blank'), false)
  assert.equal(isHttpUrl('about:'), false)
  assert.equal(isHttpUrl('file:///C:/tmp'), false)
  assert.equal(isHttpUrl('ms-windows-store://pdp'), false)
  assert.equal(isHttpUrl('javascript:alert(1)'), false)
  assert.equal(isHttpUrl(''), false)
  assert.equal(isHttpUrl(null), false)
})
