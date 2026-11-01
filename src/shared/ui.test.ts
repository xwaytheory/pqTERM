import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_UI, sanitizeUi, UI_FONT_MAX, UI_FONT_MIN, UI_SCROLLBACK_MAX, UI_ZOOM_MAX, UI_ZOOM_MIN, isPaneWorking, type PaneActivity } from './types.ts'

test('a patch keeps everything it does not mention', () => {
  const next = sanitizeUi({ accent: 'blue' }, DEFAULT_UI)
  assert.equal(next.accent, 'blue')
  assert.equal(next.fontSize, DEFAULT_UI.fontSize)
  assert.equal(next.cursorStyle, DEFAULT_UI.cursorStyle)
  assert.equal(next.cursorBlink, DEFAULT_UI.cursorBlink)
  assert.equal(next.scrollback, DEFAULT_UI.scrollback)
})

test('unknown or malformed values fall back to the previous settings', () => {
  assert.equal(sanitizeUi({ accent: 'chartreuse' as never }, DEFAULT_UI).accent, 'mono')
  assert.equal(sanitizeUi({ cursorStyle: 7 as never }, DEFAULT_UI).cursorStyle, 'bar')
  assert.equal(sanitizeUi({ cursorBlink: 'yes' as never }, DEFAULT_UI).cursorBlink, true)
  assert.deepEqual(sanitizeUi(undefined, DEFAULT_UI), DEFAULT_UI)
  assert.deepEqual(sanitizeUi(null as never, DEFAULT_UI), DEFAULT_UI)
  const mine = { ...DEFAULT_UI, accent: 'amber' as const, fontSize: 16 }
  assert.deepEqual(sanitizeUi({ fontSize: 'big' as never }, mine), mine)
})

test('numbers are clamped and rounded, never trusted', () => {
  assert.equal(sanitizeUi({ fontSize: 4000 }).fontSize, UI_FONT_MAX)
  assert.equal(sanitizeUi({ fontSize: 2 }).fontSize, UI_FONT_MIN)
  assert.equal(sanitizeUi({ fontSize: 13.6 }).fontSize, 14)
  assert.equal(sanitizeUi({ fontSize: Number.NaN }).fontSize, DEFAULT_UI.fontSize)
  assert.equal(sanitizeUi({ fontSize: Infinity }).fontSize, DEFAULT_UI.fontSize)
  assert.equal(sanitizeUi({ scrollback: -5 }).scrollback, 0)
  assert.equal(sanitizeUi({ scrollback: 1e9 }).scrollback, UI_SCROLLBACK_MAX)
})

test('zoom clamps to the supported band and round-trips cleanly', () => {
  assert.equal(sanitizeUi({ zoom: 5 }).zoom, UI_ZOOM_MAX)
  assert.equal(sanitizeUi({ zoom: 0 }).zoom, UI_ZOOM_MIN)
  assert.equal(sanitizeUi({ zoom: 1.249999 }).zoom, 1.25)
  assert.equal(sanitizeUi({ zoom: Number.NaN }).zoom, DEFAULT_UI.zoom)
  assert.equal(sanitizeUi({ zoom: Infinity }).zoom, DEFAULT_UI.zoom)
  assert.equal(sanitizeUi({}, DEFAULT_UI).zoom, DEFAULT_UI.zoom)
})

test('favourites are a patch field like any other', () => {
  const base = { ...DEFAULT_UI, favoriteEngines: ['claude' as const, 'codex' as const] }
  assert.deepEqual(sanitizeUi({}, base).favoriteEngines, ['claude', 'codex'])
  assert.deepEqual(sanitizeUi({ favoriteEngines: [] }, base).favoriteEngines, [])
  assert.deepEqual(sanitizeUi({ favoriteEngines: ['kimi'] }, base).favoriteEngines, ['kimi'])
  assert.deepEqual(sanitizeUi(undefined, base).favoriteEngines, ['claude', 'codex'])
  assert.notEqual(sanitizeUi({}, base).favoriteEngines, base.favoriteEngines)
})

test('junk favourites never reach the picker', () => {
  const fav = (ids: unknown): string[] =>
    sanitizeUi({ favoriteEngines: ids as never }, DEFAULT_UI).favoriteEngines
  assert.deepEqual(fav(['opencode', 'freebuff', 'opencode']), ['opencode', 'freebuff'])
  assert.deepEqual(fav(['opencode', 'nope', 'codex']), ['opencode', 'codex'])
  assert.deepEqual(fav(['opencode', 7, null, { id: 'codex' }]), ['opencode'])
  assert.deepEqual(fav(['OPENCODE', ' opencode ']), [])
  for (const bad of ['opencode', 42, null, { 0: 'opencode' }, true]) {
    assert.deepEqual(fav(bad), [])
  }
})

// The sidebar's animated "pracuje" rail/dot keys off exactly this rule.
const pane = (id: string, engine: string | null = 'opencode') => ({ id, engine })
const at = (kind: PaneActivity['kind']): PaneActivity => ({ kind, at: 0, unread: false })

test('only a producing session counts as working', () => {
  assert.equal(isPaneWorking(pane('a'), { a: at('running') }), true)
  for (const kind of ['quiet', 'ready', 'waiting', 'attention', 'exited', 'error'] as const) {
    assert.equal(isPaneWorking(pane('a'), { a: at(kind) }), false, kind)
  }
})

test('no engine, no activity entry — never working', () => {
  assert.equal(isPaneWorking(pane('a', null), { a: at('running') }), false)
  assert.equal(isPaneWorking(pane('a'), {}), false)
})
