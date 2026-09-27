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

test('BEL attention clears when the CLI keeps writing, and stays when it stops', () => {
  let now = 1_000
  const alerts: string[] = []
  const tracker = new PaneActivityTracker(() => {}, (_id, kind) => alerts.push(kind), () => now)
  tracker.start('p')
  tracker.output('p', '\x07')
  assert.equal(tracker.get().p.kind, 'attention')
  assert.equal(tracker.get().p.unread, true)
  // the notice chunk itself (same clock) must not eat the bell
  tracker.output('p', 'prompt redraw')
  assert.equal(tracker.get().p.kind, 'attention')
  now = 1_001
  tracker.output('p', 'still writing the patch')
  assert.equal(tracker.get().p.kind, 'running')
  assert.equal(tracker.get().p.unread, false)
  assert.deepEqual(alerts, ['attention'])
  tracker.notice('p', 'omp', 'Complete')
  assert.equal(tracker.get().p.kind, 'attention')
  tracker.output('p', '\x1b]9;Complete\x07')
  assert.equal(tracker.get().p.kind, 'attention')
  now = 5_000
  tracker.tick()
  assert.equal(tracker.get().p.kind, 'attention')
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

test('silence after work escalates the badge to waiting, never alerts, once per stretch', () => {
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
  assert.equal(tracker.get().p.kind, 'quiet')
  now = 60_000
  tracker.tick()
  assert.equal(tracker.get().p.kind, 'waiting')
  assert.deepEqual(alerts, []) // silence never alerts
  now = 300_000
  tracker.tick()
  assert.deepEqual(alerts, []) // once per stretch
  tracker.output('p', 'more work')
  assert.equal(tracker.get().p.kind, 'running')
  now = 350_000
  tracker.tick()
  assert.equal(tracker.get().p.kind, 'quiet')
  now = 360_000
  tracker.tick()
  assert.equal(tracker.get().p.kind, 'waiting') // new stretch, still no alert
  assert.deepEqual(alerts, [])
})

test('a fresh pane nobody asked anything stays quiet — silence alone never alerts', () => {
  let now = 0
  const alerts: string[] = []
  const tracker = new PaneActivityTracker(() => {}, (_id, kind) => alerts.push(kind), () => now)
  tracker.start('fresh')
  // the CLI prints its banner/TUI and then sits at an empty prompt
  tracker.output('fresh', 'freebuff v1 — start coding for free\r\n')
  now = 30_000
  tracker.tick()
  assert.equal(tracker.get().fresh.kind, 'quiet')
  now = 60_000
  tracker.tick()
  now = 3_600_000
  tracker.tick()
  assert.equal(tracker.get().fresh.kind, 'waiting') // badge escalates…
  assert.deepEqual(alerts, []) // …but silence never alerts, asked or not
  // typed input arms nothing alert-worthy either: silence stays silent
  tracker.input('fresh')
  now += 60_000
  tracker.tick()
  assert.equal(tracker.get().fresh.kind, 'waiting')
  assert.deepEqual(alerts, [])
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
