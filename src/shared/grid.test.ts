import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PaneArea, SnapZone } from './types.ts'
import {
  applyAreasToPanes,
  area,
  areaStyle,
  defaultAreas,
  RESIZE_EDGES,
  resizePanes,
  resolveAreas,
  snapAreas,
  splitFromCells,
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

test('defaultAreas keeps every cell usable through 20 panes', () => {
  for (let n = 1; n <= 20; n++) {
    const cells = defaultAreas(n)
    assert.equal(cells.length, n, `count ${n}`)
    assert.ok(coversUnit(cells), `count ${n} covers/partitions`)
    for (const c of cells) {
      assert.ok(c.w + EPS >= 0.2, `n=${n} width ${c.w}`)
      assert.ok(c.h + EPS >= 0.2, `n=${n} height ${c.h}`)
    }
  }
  assert.deepEqual(defaultAreas(20)[0], { x: 0, y: 0, w: 0.2, h: 0.25 })
  assert.deepEqual(defaultAreas(20)[19], { x: 0.8, y: 0.75, w: 0.2, h: 0.25 })
  assert.deepEqual(defaultAreas(11)[8], { x: 0, y: 2 / 3, w: 1 / 3, h: 1 / 3 })
})

test('defaultAreas(5/6/7/8) use equal-height rows', () => {
  const five = defaultAreas(5)
  assert.deepEqual(five[0], { x: 0, y: 0, w: 1 / 3, h: 0.5 })
  assert.deepEqual(five[2], { x: 2 / 3, y: 0, w: 1 / 3, h: 0.5 })
  assert.deepEqual(five[3], { x: 0, y: 0.5, w: 0.5, h: 0.5 })
  assert.deepEqual(five[4], { x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
  const six = defaultAreas(6)
  assert.equal(six.length, 6)
  assert.deepEqual(six[0], { x: 0, y: 0, w: 1 / 3, h: 0.5 })
  assert.deepEqual(six[5], { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 })
  const seven = defaultAreas(7)
  assert.deepEqual(seven[0], { x: 0, y: 0, w: 0.25, h: 0.5 })
  assert.deepEqual(seven[3], { x: 0.75, y: 0, w: 0.25, h: 0.5 })
  assert.deepEqual(seven[4], { x: 0, y: 0.5, w: 1 / 3, h: 0.5 })
  assert.deepEqual(seven[6], { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 })
  const eight = defaultAreas(8)
  assert.equal(eight.length, 8)
  assert.deepEqual(eight[0], { x: 0, y: 0, w: 0.25, h: 0.5 })
  assert.deepEqual(eight[3], { x: 0.75, y: 0, w: 0.25, h: 0.5 })
  assert.deepEqual(eight[4], { x: 0, y: 0.5, w: 0.25, h: 0.5 })
  assert.deepEqual(eight[7], { x: 0.75, y: 0.5, w: 0.25, h: 0.5 })
})

const sameRect = (a: PaneArea, b: PaneArea): boolean =>
  Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS &&
  Math.abs(a.w - b.w) < EPS && Math.abs(a.h - b.h) < EPS

/**
 * Adding a pane splits exactly one cell in half. That is the whole promise of
 * the "add pane" button: every rectangle the user already arranged stays put,
 * and the grid still covers the frame without overlap.
 */
test('splitFromCells halves the largest cell and moves nothing else', () => {
  const custom: PaneArea[] = [
    { x: 0, y: 0, w: 0.6, h: 1 },
    { x: 0.6, y: 0, w: 0.4, h: 0.5 },
    { x: 0.6, y: 0.5, w: 0.4, h: 0.5 }
  ]
  for (const before of [defaultAreas(3), defaultAreas(5), custom]) {
    const after = splitFromCells(before.length + 1, before)
    assert.equal(after.length, before.length + 1)
    assert.ok(coversUnit(after), `unit tiling after growing ${before.length} panes`)
    const moved = before.filter((r) => !after.some((c) => sameRect(c, r)))
    assert.equal(moved.length, 1, 'only the split cell changes')
    const largest = before.reduce((b, r) => (area(r) > area(b) + EPS ? r : b))
    assert.ok(sameRect(moved[0], largest), 'the split cell is the largest one')
    const parts = after.filter((c) => !before.some((r) => sameRect(r, c)))
    assert.equal(parts.length, 2)
    for (const part of parts) assert.ok(Math.abs(area(part) * 2 - area(largest)) < EPS)
    const box: PaneArea = {
      x: Math.min(...parts.map((p) => p.x)),
      y: Math.min(...parts.map((p) => p.y)),
      w: Math.max(...parts.map((p) => p.x + p.w)) - Math.min(...parts.map((p) => p.x)),
      h: Math.max(...parts.map((p) => p.y + p.h)) - Math.min(...parts.map((p) => p.y))
    }
    assert.ok(sameRect(box, largest), 'the two halves fill exactly the cell they replaced')
  }
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

test('resizePanes resizes both sides without translating or mutating the frame', () => {
  const panes = [
    { id: 'a', area: { x: 0, y: 0, w: 0.5, h: 1 } },
    { id: 'b', area: { x: 0.5, y: 0, w: 0.5, h: 1 } }
  ]
  const before = structuredClone(panes)
  for (const delta of [-0.125, 0.125]) {
    const expected = [
      { id: 'a', area: { x: 0, y: 0, w: 0.5 + delta, h: 1 } },
      { id: 'b', area: { x: 0.5 + delta, y: 0, w: 0.5 - delta, h: 1 } }
    ]
    assert.deepEqual(resizePanes(panes, 'a', 'e', delta, 0.25), expected)
    assert.deepEqual(resizePanes(panes, 'b', 'w', delta, -0.25), expected)
  }
  assert.deepEqual(panes, before)
})

test('resizePanes north and south use dy, not dx or an inverted sign', () => {
  const panes = [
    { id: 'a', area: { x: 0, y: 0, w: 1, h: 0.5 } },
    { id: 'b', area: { x: 0, y: 0.5, w: 1, h: 0.5 } }
  ]
  for (const delta of [-0.125, 0.125]) {
    const expected = [
      { id: 'a', area: { x: 0, y: 0, w: 1, h: 0.5 + delta } },
      { id: 'b', area: { x: 0, y: 0.5 + delta, w: 1, h: 0.5 - delta } }
    ]
    assert.deepEqual(resizePanes(panes, 'a', 's', 0.25, delta), expected)
    assert.deepEqual(resizePanes(panes, 'b', 'n', -0.25, delta), expected)
  }
})

test('resizePanes propagates through every T-junction branch and clamps against the smallest neighbour', () => {
  const panes = [
    { id: 'a', area: { x: 0, y: 0, w: 0.5, h: 0.5 } },
    { id: 'b', area: { x: 0, y: 0.5, w: 0.5, h: 0.5 } },
    { id: 'c', area: { x: 0.5, y: 0, w: 0.25, h: 1 } },
    { id: 'd', area: { x: 0.75, y: 0, w: 0.25, h: 1 } }
  ]
  const out = resizePanes(panes, 'a', 'e', 1, 0, 0.125)
  assert.deepEqual(out.map((p) => p.area), [
    { x: 0, y: 0, w: 0.625, h: 0.5 },
    { x: 0, y: 0.5, w: 0.625, h: 0.5 },
    { x: 0.625, y: 0, w: 0.125, h: 1 },
    panes[3].area
  ])
  const left = resizePanes(panes, 'c', 'w', -1, 0, 0.125)
  assert.equal(left[0].area.w, 0.125)
  assert.equal(left[1].area.w, 0.125)
  assert.equal(left[2].area.x, 0.125)
  assert.ok(coversUnit(out.map((p) => p.area)))
  assert.ok(coversUnit(left.map((p) => p.area)))
})

test('resizePanes moves only the overlapping neighbour, not the whole aligned line', () => {
  const panes = [
    { id: 'a', area: { x: 0, y: 0, w: 0.5, h: 0.5 } },
    { id: 'b', area: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
    { id: 'c', area: { x: 0, y: 0.5, w: 0.5, h: 0.5 } },
    { id: 'd', area: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } }
  ]
  const down = resizePanes(panes, 'a', 's', 0, 0.125)
  assert.equal(down[0].area.h, 0.625)
  assert.equal(down[2].area.y, 0.625)
  assert.equal(down[2].area.h, 0.375)
  assert.deepEqual(down[1].area, panes[1].area)
  assert.deepEqual(down[3].area, panes[3].area)
  const across = resizePanes(panes, 'c', 'e', 0.125, 0)
  assert.equal(across[2].area.w, 0.625)
  assert.equal(across[3].area.x, 0.625)
  assert.deepEqual(across[0].area, panes[0].area)
  assert.deepEqual(across[1].area, panes[1].area)
  assert.ok(coversUnit(down.map((p) => p.area)))
  assert.ok(coversUnit(across.map((p) => p.area)))
})

test('resizePanes keeps outer and incompletely shared edges fixed', () => {
  const full = [{ id: 'a', area: { x: 0, y: 0, w: 1, h: 1 } }]
  for (const edge of RESIZE_EDGES) assert.strictEqual(resizePanes(full, 'a', edge, 0.25, -0.25), full)
  const partial = [
    { id: 'a', area: { x: 0, y: 0, w: 0.5, h: 1 } },
    { id: 'b', area: { x: 0.5, y: 0, w: 0.5, h: 0.5 } }
  ]
  assert.strictEqual(resizePanes(partial, 'a', 'e', 0.125, 0), partial)
  const isolated = partial.slice(0, 1)
  assert.strictEqual(resizePanes(isolated, 'a', 'e', 0.125, 0), isolated)
})

test('resizePanes corner drags keep a partition and axis minima', () => {
  const panes = [
    { id: 'a', area: { x: 0, y: 0, w: 0.5, h: 0.5 } },
    { id: 'b', area: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
    { id: 'c', area: { x: 0, y: 0.5, w: 0.5, h: 0.5 } },
    { id: 'd', area: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } }
  ]
  for (const [id, edge] of [['a', 'se'], ['b', 'sw'], ['c', 'ne'], ['d', 'nw']] as const) {
    for (const sign of [-1, 1]) {
      const out = resizePanes(panes, id, edge, sign, -sign, 0.125, 0.25)
      assert.ok(coversUnit(out.map((p) => p.area)), `${id}/${edge}/${sign}`)
      for (const p of out) {
        assert.ok(p.area.w >= 0.125 - EPS && p.area.h >= 0.25 - EPS, p.id)
      }
    }
  }
  const outerCorner = resizePanes(panes, 'a', 'ne', 0.125, -0.25)
  assert.equal(outerCorner[0].area.w, 0.625)
  assert.equal(outerCorner[0].area.y, 0)
  assert.equal(outerCorner[0].area.h, 0.5)
})

test('resizePanes preserves a partition through repeated signed edge and corner moves', () => {
  for (const count of [3, 5, 6, 9]) {
    let panes = defaultAreas(count).map((c, i) => ({ id: String(i), area: c }))
    for (const delta of [-0.2, 0.35, -1, 1, -0.05]) {
      for (const id of panes.map((p) => p.id)) {
        for (const edge of RESIZE_EDGES) {
          panes = resizePanes(panes, id, edge, delta, -delta)
          assert.ok(coversUnit(panes.map((p) => p.area)), `${count}/${id}/${edge}/${delta}`)
          for (const p of panes) {
            assert.ok(p.area.w >= 0.08 - EPS && p.area.h >= 0.08 - EPS, `min size ${p.id}`)
          }
        }
      }
    }
  }
})