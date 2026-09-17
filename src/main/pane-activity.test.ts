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
