import type { PaneActivity, PaneActivityKind } from '../shared/types'
import { isIdleInputBox, isQuestion, visibleLines } from './attention.ts'

const IDLE_MS = 30_000
/** Silence after activity that counts as "waiting for you" (agent finished/prompting). */
const WAITING_MS = 60_000
const BEL_COOLDOWN_MS = 5_000
/** A blocked prompt shows up at once — the toast must not lag behind it. */
const QUESTION_MS = 15_000
/** An empty input box is a finished turn: same idea, but far more heuristic. */
const INPUT_BOX_MS = 90_000
/** Raw output tail the guess reads (the visible screen is at the end). */
const RAW_TAIL = 800

interface Entry {
  activity: PaneActivity
  ended: boolean
  control: 'osc' | 'string' | null
  escape: boolean
  lastOutputAt: number
  lastBellAt: number
  /** Clock value when attention was latched. Later output clears it. */
  attentionAt: number
  lastSemantic: PaneActivityKind | null
  /** Set once per silence stretch: one 'waiting' escalation per stretch, not per tick. */
  waitingAnnounced: boolean
  /** agent pane (not a bare shell) — only those get the "finished turn" guess. */
  agent: boolean
  /** the user typed into this pane in this session */
  asked: boolean
  /** the pane produced output at least once */
  sawOutput: boolean
  /** tail of raw output, control-free only when guessed (once a second) */
  raw: string
  /** one screen-based guess per silence stretch */
  guessed: boolean
}


/**
 * Pure pane-activity state: which panes are running, quiet (silence — NOT
 * completion), semantically ready/waiting (agent events), or exited. BEL =
 * attention until the CLI writes again; OSC-title BEL terminators are excluded
 * across chunk splits.
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

  private fresh(kind: PaneActivityKind, agent: boolean): Entry {
    const at = this.now()
    return {
      activity: { kind, at, unread: false },
      ended: false,
      control: null,
      escape: false,
      lastOutputAt: at,
      lastBellAt: -Infinity,
      attentionAt: -Infinity,
      lastSemantic: null,
      waitingAnnounced: false,
      agent,
      asked: false,
      sawOutput: false,
      raw: '',
      guessed: false
    }
  }

  start(paneId: string, opts: { agent?: boolean } = {}): void {
    const e = this.fresh('running', opts.agent === true)
    this.entries.set(paneId, e)
    this.onChange(paneId, { ...e.activity })
  }

  /** Terminal output: BEL = attention (with cooldown); OSC/DCS BELs are not bells. */
  output(paneId: string, data: string): void {
    const e = this.entries.get(paneId)
    if (!e || e.ended || !data) return
    const now = this.now()
    const wasAttention = e.activity.kind === 'attention'
    e.lastOutputAt = now
    e.waitingAnnounced = false
    e.guessed = false
    e.sawOutput = true
    e.raw = (e.raw + data).slice(-RAW_TAIL)
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
    if (bell && e.lastBellAt + BEL_COOLDOWN_MS <= now) {
      e.lastBellAt = now
      e.attentionAt = now
      this.set(paneId, e, 'attention', true)
      this.onAlert(paneId, 'attention')
      return
    }
    // omp (TERM_PROGRAM=pq → trueColor) rings BEL when a turn ends. The next
    // turn keeps writing, so a latched badge would say "needs attention" the
    // whole time it is working. Same-millisecond output (the notice chunk
    // itself) does not clear it; silence after the bell still does not.
    if (wasAttention && !bell && e.attentionAt < now) {
      e.activity = { ...e.activity, unread: false }
      this.set(paneId, e, 'running', false)
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
    e.attentionAt = this.now()
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
    if (kind === 'attention') e.attentionAt = this.now()
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
   * command). Kept for API completeness and tests: silence after input still
   * escalates the badge, but never alerts (see `tick`).
   */
  input(paneId: string): void {
    const e = this.entries.get(paneId)
    if (!e || e.ended) return
    e.lastOutputAt = this.now()
    e.waitingAnnounced = false
    e.guessed = false
    e.asked = true
  }

  /**
   * Screen-based guess for the CLIs that never send a notification of their own:
   * a yes/no affordance in the visible lines means the pane is blocked on the
   * user, an empty input box on an agent pane means the turn ended. One guess
   * per silence stretch, never for a raw shell, never without output, and never
   * over a latched BEL/OSC attention (that one is already reported).
   */
  private guess(paneId: string, e: Entry, t: number): void {
    if (e.ended || e.guessed || !e.sawOutput) return
    if (e.activity.kind === 'attention' || e.activity.kind === 'exited' || e.activity.kind === 'error') return
    const quietFor = t - e.lastOutputAt
    if (quietFor < QUESTION_MS) return
    const lines = visibleLines(e.raw)
    if (e.asked && isQuestion(lines)) {
      e.guessed = true
      e.lastSemantic = null // a new prompt is a new event, even if the last one was also a question
      this.signal(paneId, 'attention')
      return
    }
    if (e.agent && quietFor >= INPUT_BOX_MS && isIdleInputBox(lines)) {
      e.guessed = true
      e.lastSemantic = null
      this.signal(paneId, 'ready')
    }
  }

  /**
   * Silence after activity: 'quiet' at IDLE_MS, then 'waiting' at WAITING_MS —
   * status only, never a desktop alert. Output resets the stretch. Silence
   * cannot know why a CLI stopped writing (working, blocked, done, crashed), so
   * it never produces a toast on its own; the badge in pqTERM is the status
   * signal. Alerts come from explicit events: BEL, OSC 9/99/777, process exit,
   * and the screen-based guess for CLIs that send nothing.
   */
  tick(): void {
    const t = this.now()
    for (const [id, e] of this.entries) {
      this.guess(id, e, t)
      if (e.ended || e.activity.kind === 'running' || e.activity.kind === 'quiet') {
        if (
          e.activity.kind === 'running' &&
          t - e.lastOutputAt >= IDLE_MS
        ) {
          this.set(id, e, 'quiet', false)
        }
        if (
          !e.waitingAnnounced &&
          t - e.lastOutputAt >= WAITING_MS &&
          (e.activity.kind === 'quiet' || (e.activity.kind === 'running' && t - e.lastOutputAt >= WAITING_MS))
        ) {
          e.waitingAnnounced = true
          this.set(id, e, 'waiting', false)
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
