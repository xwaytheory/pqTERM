import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TermCoalescer } from './ws-coalesce.ts'

type Frame = { e: string; paneId: string; data: string }

function harness() {
  const sent: Frame[] = []
  let buffered = 0
  return {
    sent,
    setBuffered: (n: number) => {
      buffered = n
    },
    impl: {
      send: (msg: unknown) => sent.push(msg as Frame),
      bufferedAmount: () => buffered
    }
  }
}

test('TermCoalescer batches a burst into one frame per pane', () => {
  const h = harness()
  const c = new TermCoalescer(h.impl, { flushMs: 1000 })
  let expected = ''
  for (let i = 0; i < 500; i++) {
    const chunk = `x${i}`
    expected += chunk
    c.push('p1', chunk)
  }
  c.push('p2', 'y')
  assert.equal(h.sent.length, 0, 'nothing leaves before the window closes')

  c.flush()
  assert.equal(h.sent.length, 2)
  const p1 = h.sent.find((f) => f.paneId === 'p1')
  assert.equal(p1?.e, 'term')
  assert.equal(p1?.data, expected, 'chunks are concatenated in order')
  assert.equal(h.sent.find((f) => f.paneId === 'p2')?.data, 'y')
  assert.equal(c.dropped, 0)
})

test('TermCoalescer flushes itself after flushMs', async () => {
  const h = harness()
  const c = new TermCoalescer(h.impl, { flushMs: 5 })
  c.push('p', 'a')
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(h.sent.length, 1)
  c.dispose()
})

test('TermCoalescer drops the oldest pane buffer above the cap', () => {
  const h = harness()
  const c = new TermCoalescer(h.impl, { flushMs: 1000, maxBytes: 10 })
  c.push('old', 'x'.repeat(10))
  c.push('new', 'y')
  c.flush()
  assert.equal(h.sent.length, 1, 'only what still fits is sent')
  assert.equal(h.sent[0].paneId, 'new')
  assert.ok(c.dropped >= 1, 'the drop is counted')
})

test('TermCoalescer skips a window when the transport is congested', () => {
  const h = harness()
  const c = new TermCoalescer(h.impl, { flushMs: 1000, maxBuffered: 100 })
  h.setBuffered(500)
  c.push('p', 'data')
  c.flush()
  assert.equal(h.sent.length, 0, 'no frame while the peer is behind')
  assert.equal(c.dropped, 1)

  h.setBuffered(0)
  c.push('p', 'more')
  c.flush()
  assert.equal(h.sent.length, 1, 'sending resumes once the peer drains')
  assert.equal(h.sent[0].data, 'more')
})

test('TermCoalescer dispose drops pending output without sending', () => {
  const h = harness()
  const c = new TermCoalescer(h.impl, { flushMs: 1000 })
  c.push('p', 'data')
  c.dispose()
  assert.equal(h.sent.length, 0)
  c.push('p', 'after-dispose')
  c.flush()
  assert.equal(h.sent.length, 0, 'a disposed coalescer stays quiet')
})
