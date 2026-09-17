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
    return localStorage.getItem('pq-token') || ''
  } catch {
    return ''
  }
}

export class RemoteClient {
  private ws: WebSocket | null = null
  private closeConnection: ((error: Error) => void) | null = null
  private authenticated = false
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
    return this.authenticated && this.ws?.readyState === WebSocket.OPEN
  }

  async pair(pin: string, signal?: AbortSignal): Promise<string> {
    const res = await fetch('./pair', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin.trim() })
    })
    const json = (await res.json()) as { token?: string; error?: string }
    signal?.throwIfAborted()
    if (!res.ok || !json.token) throw new Error(json.error || 'para nieudana')
    this.token = json.token
    try {
      localStorage.setItem('pq-token', this.token)
    } catch {
      /* Keep the paired token usable for this connection. */
    }
    return this.token
  }

  connect(token = readToken()): Promise<AppSnapshot> {
    this.disconnect()
    this.wantOpen = true
    this.token = token
    return this.open(true)
  }

  private open(first: boolean): Promise<AppSnapshot> {
    if (!this.wantOpen || !this.token) return Promise.reject(new Error('brak tokenu'))
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}`
    return new Promise((resolve, reject) => {
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch (error) {
        this.armReconnect()
        reject(error)
        return
      }
      this.ws = ws
      const close = (error: Error) => {
        if (this.ws !== ws) return
        clearTimeout(timer)
        this.ws = null
        this.closeConnection = null
        this.authenticated = false
        ws.onmessage = ws.onerror = ws.onclose = null
        ws.close()
        reject(error)
        for (const request of this.pending.values()) request.fail(error)
        this.pending.clear()
        this.armReconnect()
        this.onEvent?.({ e: 'connection', ready: false })
      }
      this.closeConnection = close
      const timer = setTimeout(() => close(new Error('timeout')), first ? 20000 : 12000)
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(String(ev.data)) as Record<string, unknown>
          if (!msg || typeof msg !== 'object') throw new Error('invalid message')
        } catch {
          close(new Error('invalid message'))
          return
        }
        if (msg.e === 'ping') return
        if (msg.e === 'hello') {
          clearTimeout(timer)
          this.authenticated = true
          this.reconnectDelay = 2500
          if (typeof msg.token === 'string') {
            this.token = msg.token
            try {
              localStorage.setItem('pq-token', this.token)
            } catch {
              /* Connection remains usable without persistent storage. */
            }
          }
          const snap = msg.snapshot as AppSnapshot
          resolve(snap)
          this.onEvent?.({ e: 'connection', ready: true })
          this.onEvent?.({ e: 'state', snapshot: snap })
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
      ws.onerror = () => close(new Error('ws error'))
      ws.onclose = () => close(new Error('offline'))
    })
  }

  private armReconnect(): void {
    if (this.reconnectTimer || this.ws || !this.wantOpen || !this.token) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.wantOpen && !this.ws) void this.open(false).catch(() => {})
    }, this.reconnectDelay)
    // wykładniczo z jitterem — kilka telefonów w tej samej sieci nie wraca równocześnie
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 1.5 + Math.random() * 1000,
      this.maxReconnectDelay
    )
  }

  call(m: string, a: unknown[] = []): Promise<unknown> {
    if (!this.ready) return Promise.reject(new Error('offline'))
    const id = String(this.seq++)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('timeout'))
      }, 20000)
      this.pending.set(id, {
        ok: (value) => { clearTimeout(timer); resolve(value) },
        fail: (error) => { clearTimeout(timer); reject(error) }
      })
      try {
        this.ws!.send(JSON.stringify({ id, m, a }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
        this.closeConnection?.(new Error('offline'))
      }
    })
  }

  // True means queued on this socket, not acknowledged by the terminal.
  write(paneId: string, data: string): boolean {
    if (!this.ready) return false
    try {
      this.ws!.send(JSON.stringify({ m: 'term.write', a: [paneId, data] }))
      return true
    } catch {
      this.closeConnection?.(new Error('offline'))
      return false
    }
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

  fill(workspaceId: string, engine: string, prompt?: string, skipPaneId?: string): Promise<unknown> {
    return this.call('panes.fill', [{ workspaceId, engine, prompt, skipPaneId }])
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
    this.closeConnection?.(new Error('offline'))
    this.reconnectDelay = 2500
  }
}
