import type { AppSnapshot, EngineId, LayoutId, PanePatch } from '@shared/types'

type Handler = (msg: Record<string, unknown>) => void

function readToken(): string {
  try {
    const q = new URLSearchParams(location.search).get('token')
    if (q) {
      localStorage.setItem('pq-token', q)
      const u = new URL(location.href)
      u.searchParams.delete('token')
      history.replaceState({}, '', u.pathname + u.search + u.hash)
      return q
    }
  } catch {
    /* ignore */
  }
  return localStorage.getItem('pq-token') || ''
}

export class RemoteClient {
  private ws: WebSocket | null = null
  private token = ''
  private seq = 1
  private pending = new Map<string, { ok: (v: unknown) => void; fail: (e: Error) => void }>()
  private wantOpen = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  // backoff rośnie z każdą nieudaną próbą, żeby telefon nie stuktał w PC po wifi-setce
  private reconnectDelay = 2500
  private maxReconnectDelay = 30000
  onEvent: Handler | null = null

  get ready(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  async pair(pin: string): Promise<string> {
    const res = await fetch('./pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin.trim() })
    })
    const json = (await res.json()) as { token?: string; error?: string }
    if (!res.ok || !json.token) throw new Error(json.error || 'para nieudana')
    this.token = json.token
    localStorage.setItem('pq-token', this.token)
    return this.token
  }

  connect(token = readToken()): Promise<AppSnapshot> {
    this.wantOpen = true
    this.token = token
    return this.open(true)
  }

  private open(first: boolean): Promise<AppSnapshot> {
    if (!this.token) return Promise.reject(new Error('brak tokenu'))
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}`
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      const t = setTimeout(() => reject(new Error('timeout')), first ? 20000 : 12000)
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>
        if (msg.e === 'ping') return
        if (msg.e === 'hello') {
          clearTimeout(t)
          if (typeof msg.token === 'string') {
            this.token = msg.token
            localStorage.setItem('pq-token', this.token)
          }
          const snap = msg.snapshot as AppSnapshot
          this.onEvent?.({ e: 'state', snapshot: snap })
          resolve(snap)
          return
        }
        if (msg.id && this.pending.has(String(msg.id))) {
          const p = this.pending.get(String(msg.id))!
          this.pending.delete(String(msg.id))
          if (msg.ok) p.ok(msg.r)
          else p.fail(new Error(String(msg.error || 'fail')))
          return
        }
        this.onEvent?.(msg)
      }
      ws.onerror = () => {
        clearTimeout(t)
        reject(new Error('ws error'))
      }
      ws.onclose = () => {
        this.ws = null
        if (this.wantOpen) this.armReconnect()
      }
    })
  }

  private armReconnect(): void {
    if (this.reconnectTimer || !this.wantOpen || !this.token) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.open(false).catch(() => this.armReconnect())
    }, this.reconnectDelay)
    // wykładniczo z jitterem — kilka telefonów w tej samej sieci nie wraca równocześnie
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 1.5 + Math.random() * 1000,
      this.maxReconnectDelay
    )
  }

  call(m: string, a: unknown[] = []): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('offline'))
    const id = String(this.seq++)
    return new Promise((ok, fail) => {
      this.pending.set(id, { ok, fail })
      this.ws!.send(JSON.stringify({ id, m, a }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          fail(new Error('timeout'))
        }
      }, 20000)
    })
  }

  write(paneId: string, data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ m: 'term.write', a: [paneId, data] }))
  }

  select(id: string | null): Promise<unknown> {
    return this.call('workspaces.select', [id])
  }

  remove(id: string): Promise<unknown> {
    return this.call('workspaces.remove', [id])
  }

  create(input: { title: string; cwd: string; layout: LayoutId; engines: EngineId[] }): Promise<unknown> {
    return this.call('workspaces.create', [input])
  }

  setPane(workspaceId: string, paneId: string, patch: PanePatch): Promise<unknown> {
    return this.call('workspaces.setPane', [workspaceId, paneId, patch])
  }

  fill(engine: string, prompt?: string, skipPaneId?: string): Promise<unknown> {
    return this.call('panes.fill', [{ engine, prompt, skipPaneId }])
  }

  clear(workspaceId: string, paneId: string): Promise<unknown> {
    return this.call('term.clear', [workspaceId, paneId])
  }

  disconnect(): void {
    this.wantOpen = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    this.reconnectDelay = 2500
  }
}
