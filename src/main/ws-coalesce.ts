/**
 * Terminal output coalescer for the remote (phone) WebSocket.
 *
 * A PTY can emit thousands of tiny chunks per second, and the old path turned every
 * single chunk into its own JSON frame. This batches all chunks of a pane into one
 * frame per ~16 ms window, and when the peer stops draining it drops the pending
 * window instead of stacking frames: a visible gap beats an OOM.
 *
 * Kept free of `ws` types so it can be unit-tested without a real socket.
 */
export interface CoalesceSink {
  send(msg: unknown): void
  /** bytes the transport still has queued (for `ws` that is `bufferedAmount`) */
  bufferedAmount(): number
}

export interface CoalesceOpts {
  /** batching window in ms */
  flushMs?: number
  /** pending-characters cap before the oldest pane buffer gets dropped */
  maxBytes?: number
  /** transport backlog limit; above it a window is skipped instead of stacked */
  maxBuffered?: number
}

export class TermCoalescer {
  private term = new Map<string, string>()
  private bytes = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  /** frames/chunks dropped because the peer could not keep up (observability) */
  dropped = 0

  private readonly flushMs: number
  private readonly maxBytes: number
  private readonly maxBuffered: number

  // NOTE: `sink` is assigned by hand (not a constructor parameter property) so this
  // module stays loadable through `node --experimental-strip-types`, which rejects
  // parameter properties — the unit test imports it directly.
  private readonly sink: CoalesceSink

  constructor(sink: CoalesceSink, opts: CoalesceOpts = {}) {
    this.sink = sink
    this.flushMs = opts.flushMs ?? 16
    this.maxBytes = opts.maxBytes ?? 1_000_000
    this.maxBuffered = opts.maxBuffered ?? 4_000_000
  }

  push(paneId: string, data: string): void {
    if (this.disposed || !data) return
    this.term.set(paneId, (this.term.get(paneId) ?? '') + data)
    this.bytes += data.length
    while (this.bytes > this.maxBytes) this.shedOldest()
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.flushMs)
  }

  /** send what is queued now — control messages flush first so ordering stays sane */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.term.size || this.disposed) return
    if (this.sink.bufferedAmount() > this.maxBuffered) {
      this.dropped += this.term.size
      this.term.clear()
      this.bytes = 0
      return
    }
    const batch = [...this.term.entries()]
    this.term.clear()
    this.bytes = 0
    for (const [paneId, data] of batch) this.sink.send({ e: 'term', paneId, data })
  }

  /** drop pending output without sending (socket is going away) */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.term.clear()
    this.bytes = 0
    this.disposed = true
  }

  private shedOldest(): void {
    const first = this.term.keys().next()
    if (first.done) {
      this.bytes = 0
      return
    }
    const chunk = this.term.get(first.value) ?? ''
    this.bytes -= chunk.length
    this.term.delete(first.value)
    this.dropped += 1
  }
}
