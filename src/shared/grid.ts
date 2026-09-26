import type { PaneArea, PaneState, SnapZone } from './types'
// explicit .ts: strip-types test scripts import this module directly (see AGENTS.md)
import { MIN_PANE_W, MIN_PANE_H, paneUnderMin } from './term-geometry.ts'

export { MIN_PANE_W, MIN_PANE_H, paneUnderMin }

type Rect = PaneArea
type Orient = 'v' | 'h'

export const GRID_GAP = 6
export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }

// ---------------------------------------------------------------------------
// Balanced splitting (used for default layouts and for "reflow" when a pane
// snaps — the remaining panes re-split the leftover rectangle).
// ---------------------------------------------------------------------------

export function area(r: Rect): number {
  return r.w * r.h
}

export function orientFor(r: Rect): Orient {
  return r.w >= r.h ? 'v' : 'h'
}

export function splitRect(r: Rect, orient: Orient): [Rect, Rect] {
  if (orient === 'v') {
    const w = r.w / 2
    return [
      { x: r.x, y: r.y, w, h: r.h },
      { x: r.x + w, y: r.y, w: r.w - w, h: r.h }
    ]
  }
  const h = r.h / 2
  return [
    { x: r.x, y: r.y, w: r.w, h },
    { x: r.x, y: r.y + h, w: r.w, h: r.h - h }
  ]
}

function largestCellIndex(cells: Rect[]): number {
  let bi = 0
  let ba = -1
  for (let i = 0; i < cells.length; i++) {
    const a = area(cells[i])
    if (a > ba) {
      ba = a
      bi = i
    }
  }
  return bi
}

/** Repeatedly halve the largest cell until we reach `count` rects. */
export function splitFromCells(count: number, seeds: Rect[], rect: Rect = FULL): Rect[] {
  const cells: Rect[] = seeds.length ? seeds.map((s) => ({ ...s })) : [{ ...rect }]
  let safety = 0
  while (cells.length < count && safety++ < 4096) {
    const bi = largestCellIndex(cells)
    cells.splice(bi, 1, ...splitRect(cells[bi], orientFor(cells[bi])))
  }
  return cells
}

export function splitInto(count: number, rect: Rect = FULL): Rect[] {
  return splitFromCells(count, [], rect)
}

function uniformGrid(cols: number, rows: number, container: Rect = FULL): Rect[] {
  const out: Rect[] = []
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      out.push({
        x: container.x + (x / cols) * container.w,
        y: container.y + (y / rows) * container.h,
        w: container.w / cols,
        h: container.h / rows
      })
    }
  }
  return out
}

const UNIFORM: Record<number, [number, number]> = {
  1: [1, 1],
  2: [2, 1],
  3: [3, 1],
  4: [2, 2],
  6: [3, 2],
  8: [4, 2],
  9: [3, 3]
}

/** Equal-height rows. Each row's cells share that row's full width. */
function rowsLayout(counts: readonly number[]): Rect[] {
  const rows = counts.length
  const h = 1 / rows
  const out: Rect[] = []
  for (let r = 0; r < rows; r++) {
    const count = counts[r]
    for (let i = 0; i < count; i++) {
      out.push({ x: i / count, y: r * h, w: 1 / count, h })
    }
  }
  return out
}

/** Two equal-height rows with `top` and `bottom` equal-width cells. */
export function rowLayout(top: number, bottom: number): Rect[] {
  return rowsLayout([top, bottom])
}

/**
 * Even rows for counts the small templates do not cover.
 * At most five columns, so a cell stays wide enough for a terminal.
 * 16 is 4×4; a fifth column would leave the last row as one stretched cell.
 */
const TILE: Record<number, readonly number[]> = {
  10: [5, 5],
  11: [4, 4, 3],
  12: [4, 4, 4],
  13: [5, 4, 4],
  14: [5, 5, 4],
  15: [5, 5, 5],
  16: [4, 4, 4, 4],
  17: [5, 4, 4, 4],
  18: [5, 5, 4, 4],
  19: [5, 5, 5, 4],
  20: [5, 5, 5, 5]
}

/**
 * Default areas for `count` panes.
 * 5 = 3+2, 7 = 4+3; even grids use uniform cells.
 * 10–20 use TILE. Anything larger still fills rows of five
 * (add is capped at 20; this only covers a workspace that already exceeded it).
 */
export function defaultAreas(count: number): Rect[] {
  const n = Math.max(1, Math.floor(count))
  if (n === 5) return rowLayout(3, 2)
  if (n === 7) return rowLayout(4, 3)
  const u = UNIFORM[n]
  if (u) return uniformGrid(u[0], u[1])
  const tile = TILE[n]
  if (tile) return rowsLayout(tile)
  const cols = 5
  const rows = Math.ceil(n / cols)
  const counts: number[] = []
  let left = n
  for (let r = 0; r < rows; r++) {
    const take = Math.min(cols, left)
    counts.push(take)
    left -= take
  }
  return rowsLayout(counts)
}

// ---------------------------------------------------------------------------
// Aero-Snap zones
// ---------------------------------------------------------------------------

const HALF_ZONES: SnapZone[] = ['left', 'right', 'top', 'bottom']
const CORNER_ZONES: SnapZone[] = ['tl', 'tr', 'bl', 'br']

export function zoneRect(zone: SnapZone): Rect {
  switch (zone) {
    case 'full':
      return { ...FULL }
    case 'left':
      return { x: 0, y: 0, w: 0.5, h: 1 }
    case 'right':
      return { x: 0.5, y: 0, w: 0.5, h: 1 }
    case 'top':
      return { x: 0, y: 0, w: 1, h: 0.5 }
    case 'bottom':
      return { x: 0, y: 0.5, w: 1, h: 0.5 }
    case 'tl':
      return { x: 0, y: 0, w: 0.5, h: 0.5 }
    case 'tr':
      return { x: 0.5, y: 0, w: 0.5, h: 0.5 }
    case 'bl':
      return { x: 0, y: 0.5, w: 0.5, h: 0.5 }
    case 'br':
      return { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
  }
}

/** The leftover (L-shaped) cells after a corner is taken. */
const CORNER_SEEDS: Record<'tl' | 'tr' | 'bl' | 'br', Rect[]> = {
  tl: [
    { x: 0.5, y: 0, w: 0.5, h: 1 },
    { x: 0, y: 0.5, w: 0.5, h: 0.5 }
  ],
  tr: [
    { x: 0, y: 0, w: 0.5, h: 1 },
    { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
  ],
  bl: [
    { x: 0.5, y: 0, w: 0.5, h: 1 },
    { x: 0, y: 0, w: 0.5, h: 0.5 }
  ],
  br: [
    { x: 0, y: 0, w: 0.5, h: 1 },
    { x: 0.5, y: 0, w: 0.5, h: 0.5 }
  ]
}

function complementCells(zone: SnapZone): Rect[] {
  if (HALF_ZONES.includes(zone)) {
    if (zone === 'left' || zone === 'right') {
      const x = zone === 'left' ? 0.5 : 0
      return [{ x, y: 0, w: 0.5, h: 1 }]
    }
    const y = zone === 'top' ? 0.5 : 0
    return [{ x: 0, y, w: 1, h: 0.5 }]
  }
  return CORNER_SEEDS[zone as 'tl' | 'tr' | 'bl' | 'br']
}

/**
 * New areas when `snappedIndex` takes `zone`.
 * Returns null for the `full` zone (the caller should zoom instead).
 */
export function snapAreas(count: number, snappedIndex: number, zone: SnapZone): Rect[] | null {
  const n = Math.max(1, Math.floor(count))
  if (zone === 'full') return null
  if (snappedIndex < 0 || snappedIndex >= n) return null
  const target = zoneRect(zone)
  const rest = splitFromCells(n - 1, complementCells(zone))
  if (rest.length !== n - 1) return null
  const areas: Rect[] = []
  for (let i = 0; i < n; i++) {
    if (i === snappedIndex) areas.push(target)
    else areas.push(rest[i < snappedIndex ? i : i - 1])
  }
  return areas
}

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const RESIZE_EDGES: readonly ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

const ALIGN_EPS = 1e-5

type Seg = { from: number; to: number; pane: number; side: 'start' | 'end' }

function spansAt(
  panes: { id: string; area: Rect }[],
  vertical: boolean,
  line: number,
  axis: 'start' | 'end'
): Seg[] {
  const segs: Seg[] = []
  for (let i = 0; i < panes.length; i++) {
    const r = panes[i].area
    const lo = vertical ? r.x : r.y
    const hi = vertical ? r.x + r.w : r.y + r.h
    const crossLo = vertical ? r.y : r.x
    const crossHi = vertical ? r.y + r.h : r.x + r.w
    const edge = axis === 'end' ? hi : lo
    if (Math.abs(edge - line) > ALIGN_EPS) continue
    if (crossHi - crossLo <= ALIGN_EPS) continue
    segs.push({ from: crossLo, to: crossHi, pane: i, side: axis })
  }
  return segs
}

function componentsOf(segs: Seg[]): Seg[][] {
  const sorted = [...segs].sort((a, b) => a.from - b.from || a.to - b.to)
  const comps: Seg[][] = []
  let cur: Seg[] = []
  let reach = -Infinity
  for (const s of sorted) {
    if (cur.length && s.from > reach + ALIGN_EPS) {
      comps.push(cur)
      cur = []
    }
    cur.push(s)
    reach = Math.max(reach, s.to)
  }
  if (cur.length) comps.push(cur)
  return comps
}

function completeCoverage(comp: Seg[]): boolean {
  const sorted = [...comp].sort((a, b) => a.from - b.from || a.to - b.to)
  for (const seg of sorted) {
    let cover = seg.from
    for (const other of sorted) {
      if (other.side === seg.side || other.to <= cover) continue
      if (other.from > cover + ALIGN_EPS) break
      cover = Math.max(cover, other.to)
      if (cover >= seg.to - ALIGN_EPS) break
    }
    if (cover < seg.to - ALIGN_EPS) return false
  }
  return true
}

function applyShift(
  panes: { id: string; area: Rect }[],
  comp: Seg[],
  vertical: boolean,
  delta: number,
  minSize: number,
  line: number
): { id: string; area: Rect }[] | null {
  if (!comp.length || !completeCoverage(comp)) return null
  let lower = -line
  let upper = 1 - line
  for (const seg of comp) {
    const r = panes[seg.pane].area
    const room = Math.max(0, (vertical ? r.w : r.h) - minSize)
    if (seg.side === 'end') lower = Math.max(lower, -room)
    else upper = Math.min(upper, room)
  }
  const applied = Math.max(lower, Math.min(upper, delta))
  if (applied === 0) return null
  const out = panes.slice()
  for (const seg of comp) {
    const p = panes[seg.pane]
    const r = p.area
    const start = seg.side === 'start'
    out[seg.pane] = {
      ...p,
      area: vertical
        ? { ...r, x: r.x + (start ? applied : 0), w: r.w + (start ? -applied : applied) }
        : { ...r, y: r.y + (start ? applied : 0), h: r.h + (start ? -applied : applied) }
    }
  }
  return out
}

function shiftEdge(
  panes: { id: string; area: Rect }[],
  id: string,
  vertical: boolean,
  side: 'start' | 'end',
  delta: number,
  minSize: number
): { id: string; area: Rect }[] {
  if (delta === 0) return panes
  const index = panes.findIndex((p) => p.id === id)
  if (index < 0) return panes
  const self = panes[index].area
  const lo = vertical ? self.x : self.y
  const size = vertical ? self.w : self.h
  const line = side === 'end' ? lo + size : lo
  if (line <= ALIGN_EPS || line >= 1 - ALIGN_EPS) return panes
  const all = [
    ...spansAt(panes, vertical, line, 'start'),
    ...spansAt(panes, vertical, line, 'end')
  ]
  const crossLo = vertical ? self.y : self.x
  const crossHi = vertical ? self.y + self.h : self.x + self.w
  const local = all.filter((s) => s.from < crossHi - ALIGN_EPS && s.to > crossLo + ALIGN_EPS)
  const moved = applyShift(panes, local, vertical, delta, minSize, line)
  if (moved) return moved
  const full = componentsOf(all).find((c) => c.some((s) => s.pane === index && s.side === side))
  return (full && applyShift(panes, full, vertical, delta, minSize, line)) || panes
}


/**
 * Drag-resize pane `id` by dragging its edge/corner. `dx`/`dy` are deltas from
 * drag start in unit space. Prefers the overlapping neighbour on that edge so
 * a column/row split moves alone; T-junctions fall back to the full shared line.
 * Clamped so no affected pane shrinks below its minimum; outer frame edges do
 * not move. Returns the array unchanged when the move is impossible.
 */
export function resizePanes(
  panes: { id: string; area: Rect }[],
  id: string,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  minWidth = 0.08,
  minHeight = 0.08
): { id: string; area: Rect }[] {
  if (!Number.isFinite(minWidth) || !Number.isFinite(minHeight) || minWidth <= 0 || minHeight <= 0) return panes
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return panes
  let out = panes
  const doX = edge.includes('e') || edge.includes('w')
  const doY = edge.includes('n') || edge.includes('s')
  if (doX) {
    out = shiftEdge(out, id, true, edge.includes('e') ? 'end' : 'start', dx, minWidth)
  }
  if (doY) {
    out = shiftEdge(out, id, false, edge.includes('s') ? 'end' : 'start', dy, minHeight)
  }
  return out
}

// ---------------------------------------------------------------------------
// Zone detection from a normalized pointer position (0..1 within the grid).
// ---------------------------------------------------------------------------

const CORNER = 0.2
const EDGE = 0.32
const CENTER_A = 0.35
const CENTER_B = 0.65

export function zoneNear(x: number, y: number): SnapZone | null {
  if (x < CORNER && y < CORNER) return 'tl'
  if (x > 1 - CORNER && y < CORNER) return 'tr'
  if (x < CORNER && y > 1 - CORNER) return 'bl'
  if (x > 1 - CORNER && y > 1 - CORNER) return 'br'
  if (x <= EDGE) return 'left'
  if (x >= 1 - EDGE) return 'right'
  if (y <= EDGE) return 'top'
  if (y >= 1 - EDGE) return 'bottom'
  if (x >= CENTER_A && x <= CENTER_B && y >= CENTER_A && y <= CENTER_B) return 'full'
  return null
}

// ---------------------------------------------------------------------------
// Area resolution / mutation helpers (shared by main + renderer)
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const round6 = (v: number): number => Math.round(v * 1e6) / 1e6

function normalizeArea(r: Rect): Rect {
  const w = clamp(r.w, 0, 1)
  const h = clamp(r.h, 0, 1)
  return {
    x: round6(clamp(r.x, 0, 1 - w)),
    y: round6(clamp(r.y, 0, 1 - h)),
    w: round6(Math.max(0.000001, w)),
    h: round6(Math.max(0.000001, h))
  }
}

export function resolveAreas(
  panes: { id: string; area?: PaneArea }[]
): { id: string; area: Rect }[] {
  const n = panes.length
  const def = defaultAreas(n)
  return panes.map((p, i) => ({
    id: p.id,
    area: p.area ? normalizeArea(p.area) : def[i]
  }))
}

export function resolveAreaFor(area: PaneArea | undefined, i: number, count: number): Rect {
  const def = defaultAreas(count)
  return area ? normalizeArea(area) : def[i]
}

export function swapAreasById(
  areas: { id: string; area: Rect }[],
  aId: string,
  bId: string
): { id: string; area: Rect }[] {
  if (aId === bId) return areas
  let ai = -1
  let bi = -1
  for (let i = 0; i < areas.length; i++) {
    if (areas[i].id === aId) ai = i
    if (areas[i].id === bId) bi = i
  }
  if (ai < 0 || bi < 0) return areas
  const copy = areas.map((e) => ({ id: e.id, area: e.area }))
  const tmp = copy[ai].area
  copy[ai].area = copy[bi].area
  copy[bi].area = tmp
  return copy
}

export function applyAreasToPanes(
  panes: PaneState[],
  areas: { id: string; area: Rect }[]
): PaneState[] {
  const byId = new Map(areas.map((e) => [e.id, e.area]))
  return panes.map((p) => (byId.has(p.id) ? { ...p, area: byId.get(p.id) } : p))
}

// ---------------------------------------------------------------------------
// CSS placement
// ---------------------------------------------------------------------------

/** React style that absolutely positions a pane inside the `.grid` container. */
export function areaStyle(area?: PaneArea, gap = GRID_GAP): Record<string, string> {
  if (!area) {
    return { left: '0', top: '0', width: '100%', height: '100%', position: 'absolute' }
  }
  return {
    position: 'absolute',
    left: `calc(${area.x * 100}% + ${gap}px)`,
    top: `calc(${area.y * 100}% + ${gap}px)`,
    width: `calc(${area.w * 100}% - ${gap * 2}px)`,
    height: `calc(${area.h * 100}% - ${gap * 2}px)`
  }
}