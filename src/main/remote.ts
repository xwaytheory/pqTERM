import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  appendFileSync
} from 'fs'
import { extname, join, normalize, dirname } from 'path'
import { networkInterfaces } from 'os'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { randomBytes, randomInt, timingSafeEqual } from 'crypto'
import https from 'https'
import { pipeline } from 'stream/promises'
import { WebSocketServer, type WebSocket } from 'ws'
import { TermCoalescer } from './ws-coalesce'
import type { AppSnapshot, RemoteInfo } from '../shared/types'

const PORT = 4747
/** `/pair` is public: a 1 KiB JSON pin is all it ever carries (used to buffer anything) */
const PAIR_MAX_BODY = 1024

/** static phone bundle cache — the 445 KB bundle was read from disk on every request */
const STATIC_CACHE = new Map<string, { body: Buffer; etag: string }>()

function readStatic(file: string): { body: Buffer; etag: string } {
  const st = statSync(file)
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`
  const hit = STATIC_CACHE.get(file)
  if (hit && hit.etag === etag) return hit
  const entry = { body: readFileSync(file), etag }
  if (STATIC_CACHE.size >= 32) STATIC_CACHE.clear()
  STATIC_CACHE.set(file, entry)
  return entry
}
const CLOUDFLARED_URL =
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'

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

type Persist = {
  enabled: boolean
  token: string
  pin: string
  wanUrl?: string | null
  deviceId?: string
}

function lanIps(): string[] {
  const out: string[] = []
  const nics = networkInterfaces()
  for (const list of Object.values(nics)) {
    for (const a of list || []) {
      if (a.internal || a.family !== 'IPv4') continue
      if (a.address.startsWith('172.20.') || a.address.startsWith('169.254.')) continue
      out.push(a.address)
    }
  }
  return [...new Set(out)]
}

function tailscaleIp(signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('tailscale', ['ip', '-4'], { signal, windowsHide: true, timeout: 2500 }, (err, stdout) => {
      if (err) return resolve(null)
      const ip = String(stdout || '')
        .trim()
        .split(/\s+/)[0]
      resolve(ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null)
    })
  })
}

async function downloadHttps(url: string, dest: string, signal: AbortSignal): Promise<void> {
  for (let hops = 0; hops <= 6; hops++) {
    signal.throwIfAborted()
    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      https.get(url, { signal, headers: { 'User-Agent': 'pq-remote' } }, resolve).on('error', reject)
    })
    const code = res.statusCode || 0
    if (code >= 300 && code < 400 && res.headers.location) {
      res.resume()
      url = new URL(res.headers.location, url).href
      continue
    }
    if (code !== 200) {
      res.resume()
      throw new Error(`pobieranie tunelu HTTP ${code}`)
    }
    await pipeline(res, createWriteStream(dest), { signal })
    return
  }
  throw new Error('za dużo przekierowań')
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
  /** one terminal-output batcher per connected socket (backpressure per peer) */
  private coalescers = new Map<WebSocket, TermCoalescer>()
  private extraUrls: string[] = []
  private wanUrl: string | null = null
  private tunnel: ChildProcess | null = null
  private tunnelStatus: RemoteInfo['tunnel'] = 'off'
  private tunnelError = ''
  private persistEnabled = false
  private pairFails = 0
  private pairBlockedUntil = 0
  private lifecycle = 0
  private startPending: Promise<RemoteInfo> | null = null
  private startAbort: AbortController | null = null
  private tunnelPending: Promise<void> | null = null
  private tunnelAbort: AbortController | null = null
  private tunnelCleanup: (() => void) | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private cancelListen: (() => void) | null = null
  private deviceId = ''
  /** renderer subscribers pushed on every info() mutation (IPC 'remote:changed') */
  private listeners = new Set<(info: RemoteInfo) => void>()

  constructor(
    private opts: {
      rootDir: string
      persistFile: string
      binDir: string
      snapshot: () => AppSnapshot
      dispatch: (cmd: RemoteCommand) => Promise<unknown>
    }
  ) {
    this.loadPersist()
  }

  info(): RemoteInfo {
    const urls: string[] = []
    if (this.enabled) {
      if (this.wanUrl) urls.push(this.wanUrl)
      for (const ip of this.extraUrls) urls.push(`http://${ip}:${this.port}`)
      for (const ip of lanIps()) urls.push(`http://${ip}:${this.port}`)
    }
    return {
      enabled: this.enabled,
      pin: this.pin,
      port: this.port,
      urls: [...new Set(urls)],
      wanUrl: this.enabled ? this.wanUrl : null,
      tunnel: this.enabled ? this.tunnelStatus : 'off',
      tunnelError: this.enabled ? this.tunnelError : '',
      clients: this.sockets.size
    }
  }

  onChange(cb: (info: RemoteInfo) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private notify(): void {
    if (!this.listeners.size) return
    const next = this.info()
    for (const cb of this.listeners) cb(next)
  }

  pushState(): void {
    const snap = this.publicSnapshot()
    this.broadcast({ e: 'state', snapshot: snap })
  }

  pushTerm(paneId: string, data: string): void {
    for (const s of this.sockets) this.coalescerFor(s).push(paneId, data)
  }

  pushExit(paneId: string, code: number): void {
    this.broadcast({ e: 'exit', paneId, code })
  }

  async restore(): Promise<RemoteInfo | null> {
    this.loadPersist()
    if (!this.persistEnabled) return null
    return this.start()
  }

  start(): Promise<RemoteInfo> {
    if (this.startPending) return this.startPending
    if (this.enabled && this.http) {
      if (!this.wanUrl && !this.tunnel && !this.restartTimer) void this.ensureTunnel()
      return Promise.resolve(this.info())
    }
    const generation = ++this.lifecycle
    const pending = this.startHub(generation)
    this.startPending = pending
    void pending.finally(() => {
      if (this.startPending === pending) this.startPending = null
    }).catch(() => undefined)
    return pending
  }

  private async startHub(generation: number): Promise<RemoteInfo> {
    const controller = new AbortController()
    this.startAbort = controller
    this.loadPersist()
    if (!this.token) this.token = randomBytes(24).toString('hex')
    if (!this.pin) this.pin = String(randomInt(100000, 999999))
    try {
      await this.listen()
      if (generation !== this.lifecycle) return this.info()
      const ts = await tailscaleIp(controller.signal)
      if (generation !== this.lifecycle) return this.info()
      this.extraUrls = ts ? [ts] : []
      this.enabled = true
      this.persistEnabled = true
      this.savePersist()
      this.openFirewall()
      await this.ensureTunnel()
      if (generation === this.lifecycle) this.notify()
      return this.info()
    } catch (err) {
      if (generation !== this.lifecycle) return this.info()
      this.stop()
      throw err
    } finally {
      if (this.startAbort === controller) this.startAbort = null
    }
  }

  stop(forget = false): RemoteInfo {
    ++this.lifecycle
    this.startPending = null
    this.startAbort?.abort()
    this.startAbort = null
    this.cancelListen?.()
    this.enabled = false
    this.killTunnel()
    for (const s of this.sockets) {
      try {
        s.terminate()
      } catch {
        /* ignore */
      }
    }
    for (const c of this.coalescers.values()) c.dispose()
    this.coalescers.clear()
    this.sockets.clear()
    this.wss?.close()
    this.http?.close()
    this.wss = null
    this.http = null
    this.extraUrls = []
    this.wanUrl = null
    this.tunnelStatus = 'off'
    this.tunnelError = ''
    if (forget) this.persistEnabled = false
    this.savePersist()
    this.notify()
    return this.info()
  }

  regenPin(): RemoteInfo {
    this.pin = String(randomInt(100000, 999999))
    this.pairFails = 0
    this.savePersist()
    this.notify()
    return this.info()
  }

  private loadPersist(): void {
    try {
      if (!existsSync(this.opts.persistFile)) {
        if (!this.deviceId) this.deviceId = randomBytes(8).toString('hex')
        return
      }
      const raw = readFileSync(this.opts.persistFile, 'utf8').replace(/^\uFEFF/, '')
      const p = JSON.parse(raw) as Persist
      if (typeof p.token === 'string' && p.token.length >= 16) this.token = p.token
      if (typeof p.pin === 'string' && /^\d{6}$/.test(p.pin)) this.pin = p.pin
      if (typeof p.deviceId === 'string' && p.deviceId.length >= 8) this.deviceId = p.deviceId
      this.persistEnabled = Boolean(p.enabled)
    } catch {
      /* ignore */
    }
    if (!this.deviceId) this.deviceId = randomBytes(8).toString('hex')
  }

  private savePersist(): void {
    try {
      mkdirSync(dirname(this.opts.persistFile), { recursive: true })
      const p: Persist = {
        enabled: this.persistEnabled,
        token: this.token,
        pin: this.pin,
        wanUrl: this.wanUrl,
        deviceId: this.deviceId
      }
      writeFileSync(this.opts.persistFile, JSON.stringify(p, null, 2), 'utf8')
    } catch {
      /* ignore */
    }
  }

  private log(msg: string): void {
    try {
      const file = this.opts.persistFile.replace(/remote\.json$/i, 'remote.log')
      appendFileSync(file, `${new Date().toISOString()} ${msg}\n`)
    } catch {
      /* ignore */
    }
  }

  private openFirewall(): void {
    // drop the pre-rebrand rule (best effort, needs elevation anyway)
    execFile('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name=pq-remote'], () => undefined)
    execFile(
      'netsh',
      [
        'advfirewall',
        'firewall',
        'add',
        'rule',
        'name=pqterm-remote',
        'dir=in',
        'action=allow',
        'protocol=TCP',
        `localport=${this.port}`
      ],
      { windowsHide: true },
      () => undefined
    )
  }

  private cloudflaredPath(): string {
    return join(this.opts.binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  }

  private async ensureBinary(signal: AbortSignal): Promise<string> {
    const dest = this.cloudflaredPath()
    if (existsSync(dest) && statSync(dest).size > 1_000_000) return dest
    mkdirSync(this.opts.binDir, { recursive: true })
    const tmp = dest + '.' + randomBytes(8).toString('hex') + '.tmp'
    try {
      await downloadHttps(CLOUDFLARED_URL, tmp, signal)
      signal.throwIfAborted()
      renameSync(tmp, dest)
      return dest
    } finally {
      try { unlinkSync(tmp) } catch { /* already renamed or absent */ }
    }
  }

  private ensureTunnel(): Promise<void> {
    if (!this.enabled || this.tunnel) return Promise.resolve()
    if (this.tunnelPending) return this.tunnelPending
    const controller = new AbortController()
    this.tunnelAbort = controller
    this.tunnelStatus = 'starting'
    this.tunnelError = ''
    this.wanUrl = null
    this.notify()
    const pending = (async () => {
      try {
        const bin = await this.ensureBinary(controller.signal)
        if (this.tunnelAbort !== controller || controller.signal.aborted || !this.enabled) return
        await this.spawnTunnel(bin)
      } catch (err) {
        if (this.tunnelAbort !== controller || controller.signal.aborted || !this.enabled) return
        this.tunnelStatus = 'error'
        this.tunnelError = err instanceof Error ? err.message : String(err)
        this.log(`tunnel error ${this.tunnelError}`)
        this.notify()
      }
    })()
    this.tunnelPending = pending
    void pending.finally(() => {
      if (this.tunnelPending === pending) this.tunnelPending = null
    }).catch(() => undefined)
    return pending
  }

  private spawnTunnel(bin: string): Promise<void> {
    return new Promise<void>((resolve) => {
    const generation = this.lifecycle
    const cfLog = join(this.opts.binDir, `cloudflared-${randomBytes(8).toString('hex')}.log`)
    const child = spawn(bin, [
      'tunnel', '--url', `http://127.0.0.1:${this.port}`, '--no-autoupdate',
      '--protocol', 'http2', '--logfile', cfLog
    ], { windowsHide: true, stdio: 'ignore' })
    child.on('close', () => {
      try { unlinkSync(cfLog) } catch { /* absent or still held by the OS */ }
    })
    this.tunnel = child
    const current = () => this.enabled && this.lifecycle === generation && this.tunnel === child
    let poll: NodeJS.Timeout | undefined
    let timeout: NodeJS.Timeout | undefined
    const cleanup = () => {
      clearInterval(poll)
      clearTimeout(timeout)
      if (this.tunnelCleanup === cleanup) this.tunnelCleanup = null
      resolve()
    }
    this.tunnelCleanup = cleanup
    const grabUrl = (): boolean => {
      if (!current()) return false
      try {
        const match = readFileSync(cfLog, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
        if (!match) return false
        this.wanUrl = match[0].toLowerCase()
        this.tunnelStatus = 'up'
        this.tunnelError = ''
        this.savePersist()
        this.notify()
        cleanup()
        return true
      } catch {
        return false
      }
    }
    poll = setInterval(grabUrl, 400)
    timeout = setTimeout(() => {
      if (!current()) return cleanup()
      if (!grabUrl()) {
        this.tunnelError = 'tunel jeszcze wstaje — zostaw włączone'
        this.notify()
        resolve()
      }
    }, 40000)
    child.on('error', (err) => {
      if (!current()) return
      this.killTunnel()
      this.tunnelStatus = 'error'
      this.tunnelError = err.message
      this.wanUrl = null
      this.notify()
    })
    child.on('exit', (code) => {
      if (!current()) return
      cleanup()
      this.tunnel = null
      this.wanUrl = null
      this.tunnelStatus = 'starting'
      this.tunnelError = `tunel padł (${code ?? '?'})`
      this.notify()
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null
        if (this.enabled && this.lifecycle === generation) void this.ensureTunnel()
      }, 2500)
    })
    })
  }

  private killTunnel(): void {
    this.tunnelAbort?.abort()
    this.tunnelAbort = null
    this.tunnelPending = null
    this.tunnelCleanup?.()
    clearTimeout(this.restartTimer ?? undefined)
    this.restartTimer = null
    const t = this.tunnel
    this.tunnel = null
    this.wanUrl = null
    this.tunnelStatus = 'off'
    if (!t) return
    try {
      t.kill()
    } catch {
      /* ignore */
    }
    if (process.platform === 'win32' && t.pid) {
      execFile('taskkill', ['/PID', String(t.pid), '/T', '/F'], { windowsHide: true }, () => undefined)
    }
  }

  private publicSnapshot(): AppSnapshot {
    const s = this.opts.snapshot()
    return {
      ...s,
      google: { clientId: '', clientSecret: '' }
    }
  }

  /** control frames (state/exit/…) — flush each peer's terminal tail first so output keeps its order */
  private broadcast(msg: unknown): void {
    if (!this.sockets.size) return
    const raw = JSON.stringify(msg)
    for (const s of this.sockets) {
      this.coalescers.get(s)?.flush()
      if (s.readyState === s.OPEN) s.send(raw)
    }
  }

  private coalescerFor(ws: WebSocket): TermCoalescer {
    let c = this.coalescers.get(ws)
    if (!c) {
      c = new TermCoalescer({
        send: (frame) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame))
        },
        bufferedAmount: () => ws.bufferedAmount
      })
      this.coalescers.set(ws, c)
    }
    return c
  }

  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a)
    const bb = Buffer.from(b)
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  }

  private listen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
    const server = createServer((req, res) => {
      if (this.http !== server) {
        res.writeHead(503)
        res.end()
        return
      }
      void this.serveHttp(req, res).catch(() => {
        if (res.destroyed || res.writableEnded) return
        if (res.headersSent) return res.destroy()
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid request' }))
      })
    })
    const wss = new WebSocketServer({ noServer: true })
    this.http = server
    this.wss = wss
    const done = () => {
      if (this.cancelListen === done) this.cancelListen = null
      resolve()
    }
    this.cancelListen = done
    server.on('upgrade', (req, socket, head) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        if (this.http !== server || !this.enabled || url.pathname !== '/ws' ||
            !this.safeEqual(url.searchParams.get('token') || '', this.token)) {
          socket.destroy()
          return
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
      } catch {
        socket.destroy()
      }
    })
    wss.on('connection', (ws) => {
      if (this.http !== server || !this.enabled) return ws.terminate()
      try { this.onSocket(ws) } catch { ws.terminate() }
    })
    server.on('error', (err) => {
      if (this.cancelListen === done) this.cancelListen = null
      reject(err)
    })
    server.listen(this.port, '0.0.0.0', () => {
      if (this.http !== server) server.close()
      done()
    })
    })
  }

  private onSocket(ws: WebSocket): void {
    this.sockets.add(ws)
    this.notify()
    const beat = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return
      try {
        ws.ping()
      } catch {
        /* ignore */
      }
      try {
        ws.send(JSON.stringify({ e: 'ping' }))
      } catch {
        /* ignore */
      }
    }, 20000)
    ws.on('message', (buf) => {
      void this.onMessage(ws, buf.toString()).catch(() => ws.terminate())
    })
    const gone = () => {
      clearInterval(beat)
      this.sockets.delete(ws)
      this.coalescers.get(ws)?.dispose()
      this.coalescers.delete(ws)
      this.notify()
    }
    ws.on('close', gone)
    ws.on('error', gone)
    ws.send(JSON.stringify({ e: 'hello', snapshot: this.publicSnapshot(), token: this.token }))
  }

  private async onMessage(ws: WebSocket, raw: string): Promise<void> {
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      ws.close(1008, 'invalid command')
      return
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      ws.close(1008, 'invalid command')
      return
    }
    const cmd = value as RemoteCommand
    const reply = (body: unknown): void => {
      if (!cmd.id || ws.readyState !== ws.OPEN) return
      try {
        ws.send(JSON.stringify(body))
      } catch {
        ws.terminate()
      }
    }
    if (typeof cmd.m !== 'string' || !cmd.m ||
        (cmd.id !== undefined && (typeof cmd.id !== 'string' || !cmd.id)) ||
        (cmd.a !== undefined && !Array.isArray(cmd.a))) {
      ws.close(1008, 'invalid command')
      return
    }
    if (cmd.m === 'ping') return
    if (!this.enabled || !this.sockets.has(ws)) return
    try {
      const r = await this.opts.dispatch(cmd)
      reply({ id: cmd.id, ok: true, r })
    } catch (err) {
      reply({ id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  private pairAllowed(): boolean {
    const now = Date.now()
    if (now < this.pairBlockedUntil) return false
    return true
  }

  private notePairFail(): void {
    this.pairFails += 1
    if (this.pairFails >= 5) {
      this.pairBlockedUntil = Date.now() + 45_000
      this.pairFails = 0
    }
  }

  private async serveHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const generation = this.lifecycle
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method === 'POST' && url.pathname === '/pair') {
      const chunks: Buffer[] = []
      let size = 0
      for await (const c of req) {
        if (generation !== this.lifecycle) { res.writeHead(503); res.end(); return }
        const buf = c as Buffer
        size += buf.length
        if (size > PAIR_MAX_BODY) {
          this.notePairFail()
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'za duże żądanie' }))
          req.destroy()
          return
        }
        chunks.push(buf)
      }
      if (generation !== this.lifecycle) { res.writeHead(503); res.end(); return }
      let pin = ''
      try {
        pin = String((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { pin?: string }).pin || '')
      } catch {
        pin = ''
      }
      if (!this.pairAllowed()) {
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'za dużo prób, chwila i jeszcze raz' }))
        return
      }
      if (!this.enabled || !this.pin || !this.safeEqual(pin, this.pin)) {
        this.notePairFail()
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'zły PIN' }))
        return
      }
      this.pairFails = 0
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ token: this.token, port: this.port, url: this.wanUrl || null }))
      return
    }

    const dir = join(this.opts.rootDir, 'out', 'phone')
    let rel = url.pathname === '/' ? '/index.html' : url.pathname
    try {
      rel = decodeURIComponent(rel.split('?')[0] || '/index.html')
    } catch {
      // malformed %-escape used to throw straight out of the request handler
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('zła ścieżka')
      return
    }
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
    const cached = readStatic(serve)
    if (String(req.headers['if-none-match'] || '') === cached.etag) {
      res.writeHead(304, { ETag: cached.etag })
      res.end()
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      ETag: cached.etag,
      // the phone bundle keeps its filename across builds → revalidate, don't blind-cache
      'Cache-Control': 'no-cache'
    })
    res.end(cached.body)
  }
}
