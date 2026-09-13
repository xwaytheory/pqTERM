import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PaneArea, SnapZone } from './types.ts'
import {
  applyAreasToPanes,
  area,
  areaStyle,
  defaultAreas,
  resolveAreas,
  snapAreas,
  splitInto,
  swapAreasById,
  zoneNear,
  zoneRect
} from './grid.ts'

const EPS = 1e-9

function overlap(a: PaneArea, b: PaneArea): boolean {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return ox > EPS && oy > EPS
}

function coversUnit(cells: PaneArea[], tolerance = 1e-6): boolean {
  const sum = cells.reduce((s, c) => s + area(c), 0)
  if (Math.abs(sum - 1) > tolerance) return false
  for (const c of cells) {
    if (c.x < -EPS || c.y < -EPS || c.x + c.w > 1 + EPS || c.y + c.h > 1 + EPS) return false
    if (c.w <= 0 || c.h <= 0) return false
  }
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      if (overlap(cells[i], cells[j])) return false
    }
  }
  return true
}

test('defaultAreas templates cover the unit grid without overlap', () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13]) {
    const cells = defaultAreas(n)
    assert.equal(cells.length, n, `count ${n}`)
    assert.ok(coversUnit(cells), `count ${n} covers/partitions`)
  }
})

test('defaultAreas(5) uses the big-left + 2x2 right layout', () => {
  const cells = defaultAreas(5)
  assert.deepEqual(cells[0], { x: 0, y: 0, w: 0.5, h: 1 })
  assert.deepEqual(cells[1], { x: 0.5, y: 0, w: 0.25, h: 0.5 })
  assert.deepEqual(cells[4], { x: 0.75, y: 0.5, w: 0.25, h: 0.5 })
})

test('splitInto partitions into arbitrary counts', () => {
  for (const n of [2, 3, 4, 7, 12]) {
    const cells = splitInto(n)
    assert.equal(cells.length, n)
    assert.ok(coversUnit(cells))
  }
})

test('snapAreas right-half reflows the rest into the left half', () => {
  const cells = snapAreas(6, 0, 'right')
  assert.ok(cells)
  assert.deepEqual(cells[0], { x: 0.5, y: 0, w: 0.5, h: 1 })
  const rest = cells.slice(1)
  assert.ok(coversUnit(rest.map((c) => ({ x: c.x * 2, y: c.y, w: c.w * 2, h: c.h })), 1e-6))
  assert.ok(coversUnit(cells))
})

test('snapAreas keeps the target slot index stable', () => {
  const cells = snapAreas(4, 2, 'left')!
  assert.deepEqual(cells[2], { x: 0, y: 0, w: 0.5, h: 1 })
})

test('snapAreas corner drops the leftover L-shape', () => {
  for (const zone of ['tl', 'tr', 'bl', 'br'] as SnapZone[]) {
    const cells = snapAreas(6, 1, zone)
    assert.ok(cells, zone)
    assert.deepEqual(cells[1], zoneRect(zone as SnapZone), zone)
    assert.ok(coversUnit(cells), zone)
  }
})

test('snapAreas full returns null (caller zooms)', () => {
  assert.equal(snapAreas(4, 0, 'full'), null)
})

test('zoneNear picks snap-able edges, corners and center', () => {
  assert.equal(zoneNear(0.05, 0.5), 'left')
  assert.equal(zoneNear(0.95, 0.5), 'right')
  assert.equal(zoneNear(0.5, 0.05), 'top')
  assert.equal(zoneNear(0.5, 0.95), 'bottom')
  assert.equal(zoneNear(0.03, 0.03), 'tl')
  assert.equal(zoneNear(0.97, 0.03), 'tr')
  assert.equal(zoneNear(0.03, 0.97), 'bl')
  assert.equal(zoneNear(0.97, 0.97), 'br')
  assert.equal(zoneNear(0.5, 0.5), 'full')
  assert.equal(zoneNear(0.4, 0.6), 'full')
  assert.equal(zoneNear(0.9, 0.9), 'br')
  assert.equal(zoneNear(0.5, 0.5), 'full')
})

test('zoneNear returns null in open space between zones', () => {
  assert.equal(zoneNear(0.33, 0.5), null)
  assert.equal(zoneNear(0.5, 0.34), null)
  assert.equal(zoneNear(0.42, 0.66), null)
})

test('resolveAreas falls back to defaults when areas are missing', () => {
  const panes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const areas = resolveAreas(panes)
  assert.equal(areas.length, 3)
  for (const a of areas) {
    assert.ok(a.area.w > 0 && a.area.h > 0)
  }
  const sum = areas.reduce((s, x) => s + area(x.area), 0)
  assert.ok(Math.abs(sum - 1) < 1e-6)
})

test('resolveAreas keeps explicit areas and clamps them', () => {
  const panes = [
    { id: 'a', area: { x: 0, y: 0, w: 0.5, h: 1 } },
    { id: 'b', area: { x: 0.5, y: 0, w: 0.5, h: 1 } }
  ]
  const areas = resolveAreas(panes)
  assert.deepEqual(areas[0].area, { x: 0, y: 0, w: 0.5, h: 1 })
  const bad = resolveAreas([{ id: 'x', area: { x: -1, y: 0, w: 3, h: 0 } }])
  assert.ok(bad[0].area.w > 0)
})

test('swapAreasById swaps two areas and keeps the rest', () => {
  const areas = [
    { id: 'a', area: { x: 0, y: 0, w: 0.5, h: 1 } },
    { id: 'b', area: { x: 0.5, y: 0, w: 0.5, h: 1 } },
    { id: 'c', area: { x: 0, y: 0, w: 0.5, h: 0.5 } }
  ]
  const swapped = swapAreasById(areas, 'a', 'b')
  assert.deepEqual(swapped[1].area, { x: 0, y: 0, w: 0.5, h: 1 })
  assert.deepEqual(swapped[0].area, { x: 0.5, y: 0, w: 0.5, h: 1 })
  assert.deepEqual(swapped[2].area, { x: 0, y: 0, w: 0.5, h: 0.5 })
  assert.equal(swapAreasById(areas, 'a', 'a'), areas)
  assert.equal(swapAreasById(areas, 'a', 'zz'), areas)
})

test('applyAreasToPanes patches only known pane ids', () => {
  const panes = [
    { id: 'a', title: 'A', engine: null },
    { id: 'b', title: 'B', engine: null }
  ]
  const out = applyAreasToPanes(panes, [
    { id: 'a', area: { x: 0, y: 0, w: 1, h: 1 } },
    { id: 'missing', area: { x: 0, y: 0, w: 0.1, h: 0.1 } }
  ])
  assert.deepEqual(out[0].area, { x: 0, y: 0, w: 1, h: 1 })
  assert.equal((out[1] as { area?: unknown }).area, undefined)
})

test('areaStyle emits calc() absolute positioning', () => {
  const s = areaStyle({ x: 0.5, y: 0.25, w: 0.5, h: 0.75 }, 6)
  assert.equal(s.position, 'absolute')
  assert.equal(s.left, 'calc(50% + 6px)')
  assert.equal(s.top, 'calc(25% + 6px)')
  assert.equal(s.width, 'calc(50% - 12px)')
  assert.equal(s.height, 'calc(75% - 12px)')
  const no = areaStyle(undefined)
  assert.equal(no.width, '100%')
})

test('zoneRect maps every zone to a valid unit-space rect', () => {
  for (const z of ['full', 'left', 'right', 'top', 'bottom', 'tl', 'tr', 'bl', 'br'] as SnapZone[]) {
    const r = zoneRect(z)
    assert.ok(r.w > 0 && r.h > 0)
    assert.ok(r.x >= -EPS && r.y >= -EPS && r.x + r.w <= 1 + EPS && r.y + r.h <= 1 + EPS)
  }
  assert.deepEqual(zoneRect('full'), { x: 0, y: 0, w: 1, h: 1 })
})