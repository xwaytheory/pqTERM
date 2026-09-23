import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PTY_MIN_COLS, PTY_MIN_ROWS, MIN_PANE_W, MIN_PANE_H, paneUnderMin } from './term-geometry.ts'

test('the pane floor can host a terminal at the PTY floor', () => {
  // ~9 px per cell at the default font: the pane floor must fit PTY_MIN_*
  // cells, or the guard keeps panes permanently unfitted.
  assert.ok(MIN_PANE_W >= PTY_MIN_COLS * 8, `MIN_PANE_W ${MIN_PANE_W} too small for ${PTY_MIN_COLS} cols`)
  assert.ok(MIN_PANE_H >= PTY_MIN_ROWS * 8, `MIN_PANE_H ${MIN_PANE_H} too small for ${PTY_MIN_ROWS} rows`)
})

test('panes below the floor are rejected, at-or-above accepted', () => {
  assert.equal(paneUnderMin(MIN_PANE_W - 1, MIN_PANE_H), true)
  assert.equal(paneUnderMin(MIN_PANE_W, MIN_PANE_H - 1), true)
  assert.equal(paneUnderMin(1, 1), true)
  assert.equal(paneUnderMin(MIN_PANE_W, MIN_PANE_H), false)
  assert.equal(paneUnderMin(4000, 2000), false)
})

test('the floor matches the historical clamp in pty-manager', () => {
  // 1.3.5 spawned at Math.max(20, ...) / Math.max(8, ...) — keep those exact
  // numbers so restored sessions never see a size change on re-attach.
  assert.equal(PTY_MIN_COLS, 20)
  assert.equal(PTY_MIN_ROWS, 8)
})
