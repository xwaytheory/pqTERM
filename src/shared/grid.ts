import type { PaneArea, PaneState, SnapZone } from './types'

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
  9: [3, 3]
}

/**
 * Default areas for `count` panes.
 * Nice templates for common counts; bigger/"awkward" counts get a big-left pane
 * (index 0) and a balanced split of the right half — same feel as the templates.
 */
export function defaultAreas(count: number): Rect[] {
  const n = Math.max(1, Math.floor(count))
  const u = UNIFORM[n]
  if (u) return uniformGrid(u[0], u[1])
  const right: Rect = { x: 0.5, y: 0, w: 0.5, h: 1 }
  const rest = n === 5 ? uniformGrid(2, 2, right) : splitInto(n - 1, right)
  return [{ x: 0, y: 0, w: 0.5, h: 1 }, ...rest]
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