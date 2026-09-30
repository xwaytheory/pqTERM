import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PaneActivityTracker } from './pane-activity.ts'

// A BEL is a candidate, not an alert: it is promoted only if the pane then goes
// quiet (tick, 2.5 s). A CLI that keeps writing after the bell was making noise
// between tool steps — that toasted the user mid-task (opencode, 2026-09-30).

test('a BEL alerts only after the pane stops, per pane, with burst cooldown', () => {
  let now = 0
  const alerts: string[] = []
  const tracker = new PaneActivityTracker(() => {}, (id) => alerts.push(id), () => now)
  tracker.start('a')
  tracker.start('b')
  tracker.output('a', '\x07')
  tracker.output('b', '\x07')
  assert.deepEqual(alerts, []) // candidate, not yet an alert
  now = 2_500
  tracker.tick()
  assert.deepEqual(alerts, ['a', 'b'])
  // burst: a second bell inside the cooldown is ignored entirely
  now = 3_000
  tracker.output('a', '\x07\x07')
  now = 5_500
  tracker.tick()
  assert.deepEqual(alerts, ['a', 'b'])
  now = 8_000 // cooldown from the first bell elapsed
  tracker.output('a', '\x07')
  now = 10_500
  tracker.tick()
  assert.deepEqual(alerts, ['a', 'b', 'a'])
})

test('a BEL while the CLI keeps working never alerts and never latches a badge', () => {
  let now = 0
  const alerts: string[] = []
  const tracker = new PaneActivityTracker(() => {}, (_id, kind) => alerts.push(kind), () => now)
  tracker.start('p')
  for (let i = 0; i < 20; i++) {
    now += 1_000
    tracker.output('p', `\x07step ${i} of the patch\r\n`)
    tracker.tick()
  }
  assert.deepEqual(alerts, [])
  assert.equal(tracker.get().p.kind, 'running')
  assert.equal(tracker.get().p.unread, false)
})

test('BEL attention latches on silence, and new output clears it', () => {
  let now = 1_000
  const alerts: string[] = []
  const tracker = new PaneActivityTracker(() => {}, (_id, kind) => alerts.push(kind), () => now)
  tracker.start('p')
  tracker.output('p', '\x07')
  assert.equal(tracker.get().p.kind, 'running') // not yet
  now = 3_500
  tracker.tick()
  assert.equal(tracker.get().p.kind, 'attention')
  assert.equal(tracker.get().p.unread, true)
  assert.deepEqual(alerts, ['attention'])
  now = 4_000
  tracker.output('p', 'the user answered and the agent kept going')
  assert.equal(tracker.get().p.kind, 'running')
  assert.equal(tracker.get().p.unread, false)
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
  const tracker = new PaneActivityTracker(() => {}, (id) => alerts.push(id), () => now0)
  const now0 = 10_000
  tracker.start('pane')
  tracker.output('pane', '\x1b')
  tracker.output('pane', ']0;title')
  tracker.output('pane', '\x07')
  assert.deepEqual(alerts, [])
  tracker.output('pane', '\x07')
  assert.deepEqual(alerts, [])
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
    let now = 10_000
    const alerts: string[] = []
    const tracker = new PaneActivityTracker(() => {}, (id) => alerts.push(id), () => now)
    tracker.start('p')
    tracker.output('p', '\x1b' + prefix + 'payload\x07')
    tracker.output('p', '\x07\x1b')
    assert.deepEqual(alerts, [])
    tracker.output('p', '\\\x07')
    now = 12_500
    tracker.tick()
    assert.deepEqual(alerts, ['p'])
  }
})

// ---------------------------------------------- screen-based guess (no OSC, no BEL)
// The CLIs that ship their notification channel off (or have none) still freeze
// on a prompt — that is the only signal left.

test('a blocked prompt in the visible lines alerts once, and the answer clears it', () => {
  let now = 0
  const alerts: string[] = []
  const tracker = new PaneActivityTracker(() => {}, (_id, kind) => alerts.push(kind), () => now)
  tracker.start('q', { agent: true })
  tracker.output('q', '╭──────────────────────────────╮\r\n│ Do you want to proceed? │\r\n╰──────────────────────────────╯\r\n❯ 1. Yes\r\n  2. No\r\n')
  tracker.input('q')
  now = 14_999
  tracker.tick()
  assert.deepEqual(alerts, []) // not yet — the prompt is fresh
  now = 15_000
  tracker.tick()
  assert.deepEqual(alerts, ['attention'])
  assert.equal(tracker.get().q.kind, 'attention')
  assert.equal(tracker.get().q.unread, true)
  now = 40_000
  tracker.tick()
  assert.deepEqual(alerts, ['attention']) // once per silence stretch
  now = 40_001
  tracker.output('q', 'yes\r\n')
  assert.equal(tracker.get().q.kind, 'running')
  assert.equal(tracker.get().q.unread, false)
  tracker.output('q', 'Do you want to proceed?\r\n❯ 1. Yes\r\n')
  tracker.input('q')
  now = 60_000
  tracker.tick()
  assert.deepEqual(alerts, ['attention', 'attention']) // a new question is a new alert
})

test('an empty agent input box never alerts — that shape is what a busy TUI looks like', () => {
  // Regression, 2026-09-30: opencode kept streaming while its prompt box sat
  // empty above the status bar, and the old "finished turn" rule toasted the user
  // during normal work. Silence plus an empty box proves nothing; only a yes/no
  // affordance counts.
  let now = 0
  const alerts: string[] = []
  const tracker = new PaneActivityTracker(() => {}, (_id, kind) => alerts.push(kind), () => now)
  tracker.start('agent', { agent: true })
  tracker.output('agent', 'streaming…\r\n│\r\n│ ❯ │\r\n│\r\nBuild auto · zen\r\n')
  tracker.input('agent')
  for (const at of [60_000, 90_000, 300_000, 900_000]) {
    now = at
    tracker.tick()
  }
  assert.deepEqual(alerts, [])
  assert.equal(tracker.get().agent.kind, 'waiting') // badge only, no toast
})

test('a pane nobody typed into, and a latched BEL, are never guessed at', () => {
  let now = 0
  const alerts: string[] = []
  const tracker = new PaneActivityTracker(() => {}, (_id, kind) => alerts.push(kind), () => now)
  tracker.start('p', { agent: true })
  tracker.output('p', 'Do you want to proceed?\r\n❯ 1. Yes\r\n')
  now = 120_000
  tracker.tick()
  assert.deepEqual(alerts, []) // nothing was ever asked of this pane
  assert.equal(tracker.get().p.kind, 'waiting')

  // a CLI that rang the bell and then stopped already got its toast — the
  // screen-based guess must not add a second one
  tracker.start('b', { agent: true })
  tracker.output('b', 'Do you want to proceed?\r\n❯ 1. Yes\r\n')
  tracker.input('b')
  tracker.output('b', '\x07')
  now = 130_000
  tracker.tick()
  assert.deepEqual(alerts, ['attention'])
  now = 140_000
  tracker.tick()
  assert.deepEqual(alerts, ['attention'])
})

test('a pane that never produced output is not guessed at', () => {
  let now = 0
  const alerts: string[] = []
  const tracker = new PaneActivityTracker(() => {}, (_id, kind) => alerts.push(kind), () => now)
  tracker.start('empty', { agent: true })
  tracker.input('empty')
  now = 500_000
  tracker.tick()
  assert.deepEqual(alerts, [])
  assert.equal(tracker.get().empty.unread, false)
})
