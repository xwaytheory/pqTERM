import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { existsSync, readFileSync, statSync } from 'fs'
import { extname, join, normalize } from 'path'
import { networkInterfaces } from 'os'
import { execFile } from 'child_process'
import { randomBytes, randomInt, timingSafeEqual } from 'crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type { AppSnapshot, RemoteInfo } from '../shared/types'

const PORT = 4747

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
}

function lanIps(): string[] {
  const out: string[] = []
  const nics = networkInterfaces()
  for (const list of Object.values(nics)) {
    for (const a of list || []) {
      if (a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue
      if (a.address.startsWith('172.20.') || a.address.startsWith('169.254.')) continue
      out.push(a.address)
    }
  }
  return [...new Set(out)]
}

function tailscaleIp(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('tailscale', ['ip', '-4'], { windowsHide: true, timeout: 2500 }, (err, stdout) => {
      if (err) return resolve(null)
      const ip = String(stdout || '')
        .trim()
        .split(/\s+/)[0]
      resolve(ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null)
    })
  })
}

export type RemoteCommand = {
  id?: string
  m: string
  a?: unknown[]
}

export class RemoteHub {
  enabled = false
  pin = ''
  token = randomBytes(24).toString('hex')
  port = PORT
  private http: Server | null = null
  private wss: WebSocketServer | null = null
  private sockets = new Set<WebSocket>()
  private extraUrls: string[] = []

  constructor(
    private rootDir: string,
    private hooks: {
      snapshot: () => AppSnapshot
      dispatch: (cmd: RemoteCommand) => Promise<unknown>
    }
  ) {}

  info(): RemoteInfo {
    const urls = this.enabled
      ? [...lanIps(), ...this.extraUrls].map((ip) => `http://${ip}:${this.port}`)
      : []
    return {
      enabled: this.enabled,
      pin: this.pin,
      port: this.port,
      urls,
      clients: this.sockets.size
    }
  }

  pushState(): void {
    const snap = this.publicSnapshot()
    this.broadcast({ e: 'state', snapshot: snap })
  }

  pushTerm(paneId: string, data: string): void {
    this.broadcast({ e: 'term', paneId, data })
  }

  pushExit(paneId: string, code: number): void {
    this.broadcast({ e: 'exit', paneId, code })
  }

  async start(): Promise<RemoteInfo> {
    if (this.enabled && this.http) return this.info()
    this.pin = String(randomInt(100000, 999999))
    this.token = randomBytes(24).toString('hex')
    await this.listen()
    const ts = await tailscaleIp()
    this.extraUrls = ts ? [ts] : []
    this.enabled = true
    execFile(
      'netsh',
      [
        'advfirewall',
        'firewall',
        'add',
        'rule',
        'name=pq-remote',
        'dir=in',
        'action=allow',
        'protocol=TCP',
        `localport=${this.port}`
      ],
      { windowsHide: true },
      () => undefined
    )
    return this.info()
  }

  stop(): RemoteInfo {
    for (const s of this.sockets) {
      try {
        s.close()
      } catch {
        /* ignore */
      }
    }
    this.sockets.clear()
    this.wss?.close()
    this.http?.close()
    this.wss = null
    this.http = null
    this.enabled = false
    this.pin = ''
    this.extraUrls = []
    return this.info()
  }

  regenPin(): RemoteInfo {
    this.pin = String(randomInt(100000, 999999))
    return this.info()
  }

  private publicSnapshot(): AppSnapshot {
    const s = this.hooks.snapshot()
    return {
      ...s,
      google: { clientId: '', clientSecret: '' }
    }
  }

  private broadcast(msg: unknown): void {
    if (!this.sockets.size) return
    const raw = JSON.stringify(msg)
    for (const s of this.sockets) {
      if (s.readyState === s.OPEN) s.send(raw)
    }
  }

  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a)
    const bb = Buffer.from(b)
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  }

  private listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.http = createServer((req, res) => {
        void this.serveHttp(req, res)
      })
      this.wss = new WebSocketServer({ noServer: true })
      this.http.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        if (url.pathname !== '/ws') {
          socket.destroy()
          return
        }
        const token = url.searchParams.get('token') || ''
        if (!this.safeEqual(token, this.token)) {
          socket.destroy()
          return
        }
        this.wss?.handleUpgrade(req, socket, head, (ws) => {
          this.wss?.emit('connection', ws, req)
        })
      })
      this.wss.on('connection', (ws) => this.onSocket(ws))
      this.http.on('error', reject)
      this.http.listen(this.port, '0.0.0.0', () => resolve())
    })
  }

  private onSocket(ws: WebSocket): void {
    this.sockets.add(ws)
    ws.send(JSON.stringify({ e: 'hello', snapshot: this.publicSnapshot(), token: this.token }))
    ws.on('message', (buf) => {
      void this.onMessage(ws, buf.toString())
    })
    ws.on('close', () => this.sockets.delete(ws))
    ws.on('error', () => this.sockets.delete(ws))
  }

  private async onMessage(ws: WebSocket, raw: string): Promise<void> {
    let cmd: RemoteCommand
    try {
      cmd = JSON.parse(raw) as RemoteCommand
    } catch {
      return
    }
    try {
      const r = await this.hooks.dispatch(cmd)
      if (cmd.id) ws.send(JSON.stringify({ id: cmd.id, ok: true, r }))
    } catch (err) {
      if (cmd.id) {
        ws.send(
          JSON.stringify({
            id: cmd.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          })
        )
      }
    }
  }

  private async serveHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method === 'POST' && url.pathname === '/pair') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      let pin = ''
      try {
        pin = String((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { pin?: string }).pin || '')
      } catch {
        pin = ''
      }
      if (!this.enabled || !this.pin || !this.safeEqual(pin, this.pin)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'zły PIN' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ token: this.token, port: this.port }))
      return
    }

    const dir = join(this.rootDir, 'out', 'phone')
    let rel = url.pathname === '/' ? '/index.html' : url.pathname
    rel = decodeURIComponent(rel.split('?')[0] || '/index.html')
    const file = normalize(join(dir, rel))
    if (!file.startsWith(normalize(dir))) {
      res.writeHead(403)
      res.end()
      return
    }
    const serve = existsSync(file) && statSync(file).isFile() ? file : join(dir, 'index.html')
    if (!existsSync(serve)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('pq remote: brak UI (out/phone). odpal npm run build')
      return
    }
    const ext = extname(serve)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(readFileSync(serve))
  }
}
