import type { PaneActivity, PaneActivityKind } from '../shared/types'

const IDLE_MS = 30_000
/** Silence after activity that counts as "waiting for you" (agent finished/prompting). */
const WAITING_MS = 60_000
const BEL_COOLDOWN_MS = 5_000

interface Entry {
  activity: PaneActivity
  ended: boolean
  control: 'osc' | 'string' | null
  escape: boolean
  lastOutputAt: number
  lastBellAt: number
  lastSemantic: PaneActivityKind | null
  /** Set once per silence stretch: one 'waiting' alert per stretch, not per tick. */
  waitingAnnounced: boolean
  /**
   * Someone actually asked this pane for something (typed/pasted/queued input).
   * Silence only means "waiting for you" once you are in a conversation with it —
   * a freshly spawned CLI nobody has touched is idle, not waiting.
   */
  asked: boolean
}


/**
 * Pure pane-activity state: which panes are running, quiet (silence — NOT
 * completion), semantically ready/waiting (agent events), or exited. BEL =
 * attention; OSC-title BEL terminators are excluded across chunk splits.
 */
export class PaneActivityTracker {
  private entries = new Map<string, Entry>()
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
    const at = this.now()
    return {
      activity: { kind, at, unread: false },
      ended: false,
      control: null,
      escape: false,
      lastOutputAt: at,
      lastBellAt: -Infinity,
      lastSemantic: null,
      waitingAnnounced: false,
      asked: false
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
    if (!e || e.ended || !data) return
    e.lastOutputAt = this.now()
    e.waitingAnnounced = false
    if (e.activity.kind === 'quiet' || e.activity.kind === 'waiting') {
      this.set(paneId, e, 'running', false)
    }
    let bell = false
    for (const ch of data) {
      if (e.control) {
        if ((e.control === 'osc' && ch === '\x07') || (e.escape && ch === '\\')) {
          e.control = null
        }
        e.escape = ch === '\x1b'
        continue
      }
      if (ch === '\x1b') {
        e.escape = true
        continue
      }
      if (e.escape) {
        e.escape = false
        if (ch === ']') e.control = 'osc'
        else if (ch === 'P' || ch === 'X' || ch === '^' || ch === '_') e.control = 'string'
        if (e.control) continue
      }
      if (ch === '\x07') bell = true
    }
    if (bell && e.lastBellAt + BEL_COOLDOWN_MS <= this.now()) {
      e.lastBellAt = this.now()
      this.set(paneId, e, 'attention', true)
      this.onAlert(paneId, 'attention')
    }
  }

  /**
   * The CLI sent an explicit notification request (OSC 9 / 777). Fold it into
   * activity state so the sidebar badge updates; the caller shows the toast.
   */
  notice(paneId: string, title: string, body: string): void {
    const e = this.entries.get(paneId)
    if (!e || e.ended) return
    e.lastOutputAt = this.now()
    e.waitingAnnounced = false
    e.lastSemantic = 'attention'
    this.set(paneId, e, 'attention', true)
    void title
    void body
  }

  /** Semantic event from the agent/hook layer: ready | waiting | attention | error | running. */
  signal(paneId: string, kind: PaneActivityKind): void {
    const e = this.entries.get(paneId)
    if (!e || e.ended) return
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
    if (!e || e.ended) return
    e.ended = true
    this.set(paneId, e, code === 0 ? 'exited' : 'error', true)
    this.onAlert(paneId, code === 0 ? 'exited' : 'error')
  }

  acknowledge(paneId: string): void {
    const e = this.entries.get(paneId)
    if (!e?.activity.unread) return
    e.activity = { ...e.activity, unread: false }
    this.onChange(paneId, { ...e.activity })
  }

  /**
   * Input was written to the pane's PTY (keystroke, paste, drop, bridge/board
   * command): the silence heuristic is armed from here, because now there is a
   * question that output can answer.
   */
  input(paneId: string): void {
    const e = this.entries.get(paneId)
    if (!e || e.ended) return
    e.asked = true
    e.lastOutputAt = this.now()
    e.waitingAnnounced = false
  }

  /**
   * Silence after activity: 'quiet' at IDLE_MS (status only, no alert), then
   * 'waiting' at WAITING_MS — alerted once per silence stretch, and only for a
   * pane you have actually asked something (see `input`). This is what notifies
   * for CLIs that never ring the bell (freebuff & co.): an agent stopping its
   * output for a minute after working means it wants input.
   */
  tick(): void {
    const t = this.now()
    for (const [id, e] of this.entries) {
      if (e.ended || e.activity.kind === 'running' || e.activity.kind === 'quiet') {
        if (
          e.activity.kind === 'running' &&
          t - e.lastOutputAt >= IDLE_MS
        ) {
          this.set(id, e, 'quiet', false)
        }
        if (
          e.asked &&
          !e.waitingAnnounced &&
          t - e.lastOutputAt >= WAITING_MS &&
          (e.activity.kind === 'quiet' || (e.activity.kind === 'running' && t - e.lastOutputAt >= WAITING_MS))
        ) {
          // Semantic-style alert through the same dedupe as agent events.
          e.lastSemantic = 'waiting'
          e.waitingAnnounced = true
          this.set(id, e, 'waiting', true)
          this.onAlert(id, 'waiting')
        }
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
