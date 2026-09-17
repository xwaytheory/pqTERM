import type { PaneActivity, PaneActivityKind } from '../shared/types'

const IDLE_MS = 30_000
const BEL_COOLDOWN_MS = 5_000

interface Entry {
  activity: PaneActivity
  gen: number
  bell: boolean
  osc: boolean
  dcs: boolean
  lastOutputAt: number
  lastBellAt: number
  lastSemantic: PaneActivityKind | null
}

/** True when the byte should suppress streaming detection until the sequence ends. */
function opensEscape(s: string): boolean {
  return s.includes('\x1bP') || s.includes('\x1bX') || s.includes('\x1b^') || s.includes('\x1b_')
}

/**
 * Pure pane-activity state: which panes are running, quiet (silence — NOT
 * completion), semantically ready/waiting (agent events), or exited. BEL =
 * attention; OSC-title BEL terminators are excluded across chunk splits.
 */
export class PaneActivityTracker {
  private entries = new Map<string, Entry>()
  private gen = 0
  private onChange: (paneId: string, activity: PaneActivity | null) => void
  private onAlert: (paneId: string, kind: PaneActivityKind) => void
  private now: () => number

  constructor(
    onChange: (paneId: string, activity: PaneActivity | null) => void,
    onAlert: (paneId: string, kind: PaneActivityKind) => void,
    now: () => number = Date.now
  ) {
    this.onChange = onChange
    this.onAlert = onAlert
    this.now = now
  }

  private fresh(kind: PaneActivityKind): Entry {
    this.gen += 1
    const at = this.now()
    return {
      activity: { kind, at, unread: false },
      gen: this.gen,
      bell: false,
      osc: false,
      dcs: false,
      lastOutputAt: at,
      lastBellAt: -Infinity,
      lastSemantic: null
    }
  }

  start(paneId: string): void {
    const e = this.fresh('running')
    this.entries.set(paneId, e)
    this.onChange(paneId, { ...e.activity })
  }

  /** Terminal output: BEL = attention (with cooldown); OSC/DCS BELs are not bells. */
  output(paneId: string, data: string): void {
    const e = this.entries.get(paneId)
    if (!e) return
    e.lastOutputAt = this.now()
    let bell = false
    for (const ch of data) {
      if (e.osc) {
        if (ch === '\x07' || (ch === '\\' && e.dcs)) e.osc = false
        e.dcs = ch === '\x1b'
        continue
      }
      if (ch === '\x1b') {
        e.dcs = true
        continue
      }
      if (e.dcs) {
        e.dcs = false
        if (ch === ']' || ch === 'P' || ch === 'X' || ch === '^') {
          e.osc = true
          e.dcs = opensEscape('\x1b' + ch)
          continue
        }
        if (ch === '[' || ch === '(' || ch === ')') e.dcs = false
        continue
      }
      if (ch === '\x07') bell = true
    }
    if (bell && e.lastBellAt + BEL_COOLDOWN_MS <= this.now()) {
      e.lastBellAt = this.now()
      this.set(paneId, e, 'attention', true)
      this.onAlert(paneId, 'attention')
    }
  }

  /** Semantic event from the agent/hook layer: ready | waiting | attention | error | running. */
  signal(paneId: string, kind: PaneActivityKind): void {
    const e = this.entries.get(paneId)
    if (!e) return
    if (e.lastSemantic === kind) return
    e.lastSemantic = kind
    this.set(paneId, e, kind, kind !== 'running')
    if (kind !== 'running') this.onAlert(paneId, kind)
  }

  /** Natural process end: alert once. Intentional close: no alert, drop state. */
  exit(paneId: string, code: number, intentional: boolean): void {
    if (intentional) {
      this.remove(paneId)
      return
    }
    const e = this.entries.get(paneId)
    if (!e) return
    this.set(paneId, e, code === 0 ? 'exited' : 'error', true)
    this.onAlert(paneId, code === 0 ? 'exited' : 'error')
  }

  acknowledge(paneId: string): void {
    const e = this.entries.get(paneId)
    if (!e?.activity.unread) return
    e.activity = { ...e.activity, unread: false }
    this.onChange(paneId, { ...e.activity })
  }

  /** Output without semantic events after IDLE_MS is silence, not completion. */
  tick(): void {
    const t = this.now()
    for (const [id, e] of this.entries) {
      if (
        e.activity.kind === 'running' &&
        e.lastOutputAt > 0 &&
        t - e.lastOutputAt >= IDLE_MS
      ) {
        this.set(id, e, 'quiet', false)
      }
    }
  }

  remove(paneId: string): void {
    if (!this.entries.delete(paneId)) return
    this.onChange(paneId, null)
  }

  get(): Record<string, PaneActivity> {
    const out: Record<string, PaneActivity> = {}
    for (const [id, e] of this.entries) out[id] = { ...e.activity }
    return out
  }

  private set(
    paneId: string,
    e: Entry,
    kind: PaneActivityKind,
    unread: boolean
  ): void {
    const next: PaneActivity = { kind, at: this.now(), unread: unread || e.activity.unread }
    if (next.kind === e.activity.kind && next.at - e.activity.at < 50) return
    e.activity = next
    this.onChange(paneId, { ...next })
  }

  dispose(): void {
    this.entries.clear()
  }
}
