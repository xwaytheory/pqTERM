import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PaneActivityTracker } from './pane-activity.ts'

test('BEL alerts are per-pane, suppress bursts, and resume at the cooldown boundary', () => {
  let now = 0
  const alerts: string[] = []
  const tracker = new PaneActivityTracker(() => {}, (id) => alerts.push(id), () => now)
  tracker.start('a')
  tracker.start('b')
  tracker.output('a', '\x07')
  assert.deepEqual(alerts, ['a'])
  tracker.output('a', '\x07\x07')
  tracker.output('b', '\x07')
  assert.deepEqual(alerts, ['a', 'b'])
  now = 4999
  tracker.output('a', '\x07')
  assert.deepEqual(alerts, ['a', 'b'])
  now = 5000
  tracker.output('a', '\x07')
  assert.deepEqual(alerts, ['a', 'b', 'a'])
})

test('OSC title terminators do not consume the BEL alert cooldown across chunk splits', () => {
  const alerts: string[] = []
  const tracker = new PaneActivityTracker(() => {}, (id) => alerts.push(id), () => 10000)
  tracker.start('pane')
  tracker.output('pane', '\x1b')
  tracker.output('pane', ']0;title')
  tracker.output('pane', '\x07')
  assert.deepEqual(alerts, [])
  tracker.output('pane', '\x07')
  assert.deepEqual(alerts, ['pane'])
})

test('silence is not completion and resumed output restores activity', () => {
  let now = 0
  const alerts: string[] = []
  const tracker = new PaneActivityTracker(() => {}, (_id, kind) => alerts.push(kind), () => now)
  tracker.start('p')
  now = 30000
  tracker.tick()
  assert.equal(tracker.get().p.kind, 'quiet')
  assert.deepEqual(alerts, [])
  tracker.output('p', 'working')
  assert.equal(tracker.get().p.kind, 'running')
  tracker.exit('p', 1, false)
  tracker.exit('p', 1, false)
  tracker.output('p', '\x07')
  tracker.signal('p', 'running')
  assert.equal(tracker.get().p.kind, 'error')
  assert.deepEqual(alerts, ['error'])
  tracker.start('p')
  tracker.exit('p', 0, true)
  assert.equal(tracker.get().p, undefined)
  assert.deepEqual(alerts, ['error'])
})

test('silence after work escalates to waiting and alerts exactly once per stretch', () => {
  let now = 0
  const alerts: string[] = []
  const tracker = new PaneActivityTracker(() => {}, (_id, kind) => alerts.push(kind), () => now)
  tracker.start('p')
  tracker.output('p', 'working…')
  now = 30_000
  tracker.tick()
  assert.equal(tracker.get().p.kind, 'quiet')
  assert.deepEqual(alerts, [])
  now = 59_999
  tracker.tick()
  assert.deepEqual(alerts, [])
  now = 60_000
  tracker.tick()
  assert.equal(tracker.get().p.kind, 'waiting')
  assert.deepEqual(alerts, ['waiting'])
  now = 300_000
  tracker.tick()
  assert.deepEqual(alerts, ['waiting']) // once per stretch, not per tick
  tracker.output('p', 'more work')
  assert.equal(tracker.get().p.kind, 'running')
  now = 350_000
  tracker.tick()
  assert.equal(tracker.get().p.kind, 'quiet')
  assert.deepEqual(alerts, ['waiting'])
  now = 360_000
  tracker.tick()
  assert.equal(tracker.get().p.kind, 'waiting')
  assert.deepEqual(alerts, ['waiting', 'waiting']) // new stretch, new alert
})

test('control string BEL bytes do not alert before a fragmented ST terminator', () => {
  for (const prefix of ['P', 'X', '^', '_']) {
    const alerts: string[] = []
    const tracker = new PaneActivityTracker(() => {}, (id) => alerts.push(id), () => 10000)
    tracker.start('p')
    tracker.output('p', '\x1b' + prefix + 'payload\x07')
    tracker.output('p', '\x07\x1b')
    assert.deepEqual(alerts, [])
    tracker.output('p', '\\\x07')
    assert.deepEqual(alerts, ['p'])
  }
})
