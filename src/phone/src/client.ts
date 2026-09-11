import type { AppSnapshot, EngineId, LayoutId, PanePatch } from '@shared/types'

type Handler = (msg: Record<string, unknown>) => void

export class RemoteClient {
  private ws: WebSocket | null = null
  private token = ''
  private seq = 1
  private pending = new Map<string, { ok: (v: unknown) => void; fail: (e: Error) => void }>()
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

  connect(token = localStorage.getItem('pq-token') || ''): Promise<AppSnapshot> {
    this.token = token
    if (!this.token) return Promise.reject(new Error('brak tokenu'))
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}`
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      const t = setTimeout(() => reject(new Error('timeout')), 8000)
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>
        if (msg.e === 'hello') {
          clearTimeout(t)
          if (typeof msg.token === 'string') {
            this.token = msg.token
            localStorage.setItem('pq-token', this.token)
          }
          resolve(msg.snapshot as AppSnapshot)
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
      }
    })
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
    this.ws?.close()
    this.ws = null
  }
}
