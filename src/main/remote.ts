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
import { WebSocketServer, type WebSocket } from 'ws'
import type { AppSnapshot, RemoteInfo } from '../shared/types'

const PORT = 4747
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

function downloadHttps(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const go = (u: string, hops: number) => {
      if (hops > 6) return reject(new Error('za dużo przekierowań'))
      https
        .get(u, { headers: { 'User-Agent': 'pq-remote' } }, (res) => {
          const code = res.statusCode || 0
          const loc = res.headers.location
          if (code >= 300 && code < 400 && loc) {
            res.resume()
            go(loc, hops + 1)
            return
          }
          if (code !== 200) {
            res.resume()
            reject(new Error(`pobieranie tunelu HTTP ${code}`))
            return
          }
          mkdirSync(dirname(dest), { recursive: true })
          const out = createWriteStream(dest)
          res.pipe(out)
          out.on('finish', () => out.close((err) => (err ? reject(err) : resolve())))
          out.on('error', reject)
        })
        .on('error', reject)
    }
    go(url, 0)
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
  private wanUrl: string | null = null
  private tunnel: ChildProcess | null = null
  private tunnelStatus: RemoteInfo['tunnel'] = 'off'
  private tunnelError = ''
  private persistEnabled = false
  private pairFails = 0
  private pairBlockedUntil = 0
  private restartingTunnel = false
  private stopping = false
  private deviceId = ''

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

  async restore(): Promise<RemoteInfo | null> {
    this.loadPersist()
    if (!this.persistEnabled) return null
    return this.start()
  }

  async start(): Promise<RemoteInfo> {
    this.stopping = false
    if (this.enabled && this.http) {
      if (!this.wanUrl && this.tunnelStatus !== 'starting') void this.ensureTunnel()
      return this.info()
    }
    this.loadPersist()
    if (!this.token) this.token = randomBytes(24).toString('hex')
    if (!this.pin) this.pin = String(randomInt(100000, 999999))
    await this.listen()
    const ts = await tailscaleIp()
    this.extraUrls = ts ? [ts] : []
    this.enabled = true
    this.persistEnabled = true
    this.savePersist()
    this.openFirewall()
    await this.ensureTunnel()
    return this.info()
  }

  stop(forget = false): RemoteInfo {
    this.stopping = true
    this.enabled = false
    this.killTunnel()
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
    this.extraUrls = []
    this.wanUrl = null
    this.tunnelStatus = 'off'
    this.tunnelError = ''
    if (forget) this.persistEnabled = false
    this.savePersist()
    this.stopping = false
    return this.info()
  }

  regenPin(): RemoteInfo {
    this.pin = String(randomInt(100000, 999999))
    this.pairFails = 0
    this.savePersist()
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
  }

  private cloudflaredPath(): string {
    return join(this.opts.binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  }

  private async ensureBinary(): Promise<string> {
    const dest = this.cloudflaredPath()
    if (existsSync(dest) && statSync(dest).size > 1_000_000) return dest
    mkdirSync(this.opts.binDir, { recursive: true })
    const tmp = dest + '.tmp'
    await downloadHttps(CLOUDFLARED_URL, tmp)
    try {
      if (existsSync(dest)) unlinkSync(dest)
    } catch {
      /* ignore */
    }
    renameSync(tmp, dest)
    return dest
  }

  private async ensureTunnel(): Promise<void> {
    if (this.wanUrl && this.tunnel && !this.tunnel.killed) {
      this.tunnelStatus = 'up'
      return
    }
    this.tunnelStatus = 'starting'
    this.tunnelError = ''
    this.wanUrl = null
    this.log('tunnel starting')
    try {
      const bin = await this.ensureBinary()
      this.log(`cloudflared ${bin}`)
      await this.spawnTunnel(bin)
    } catch (err) {
      this.tunnelStatus = 'error'
      this.tunnelError = err instanceof Error ? err.message : String(err)
      this.log(`tunnel error ${this.tunnelError}`)
    }
  }

  private spawnTunnel(bin: string): Promise<void> {
    this.killTunnel(false)
    return new Promise((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        resolve()
      }
      const cfLog = join(this.opts.binDir, 'cloudflared.log')
      try {
        writeFileSync(cfLog, '')
      } catch {
        /* ignore */
      }
      const grabUrl = (): boolean => {
        try {
          const s = readFileSync(cfLog, 'utf8')
          const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
          if (!m) return false
          this.wanUrl = m[0].toLowerCase()
          this.tunnelStatus = 'up'
          this.tunnelError = ''
          this.savePersist()
          this.log(`wan ${this.wanUrl}`)
          return true
        } catch {
          return false
        }
      }
      let child: ChildProcess
      try {
        child = spawn(
          bin,
          [
            'tunnel',
            '--url',
            `http://127.0.0.1:${this.port}`,
            '--no-autoupdate',
            '--protocol',
            'http2',
            '--logfile',
            cfLog
          ],
          { windowsHide: true, stdio: 'ignore' }
        )
      } catch (err) {
        this.tunnelStatus = 'error'
        this.tunnelError = err instanceof Error ? err.message : String(err)
        this.log(`spawn fail ${this.tunnelError}`)
        done()
        return
      }
      this.tunnel = child
      this.log(`cloudflared pid=${child.pid || '?'}`)
      const poll = setInterval(() => {
        if (grabUrl()) {
          clearInterval(poll)
          done()
        }
      }, 400)
      child.on('error', (err) => {
        clearInterval(poll)
        this.tunnelStatus = 'error'
        this.tunnelError = err.message
        this.log(`child error ${err.message}`)
        done()
      })
      child.on('exit', (code) => {
        clearInterval(poll)
        if (this.tunnel === child) this.tunnel = null
        this.log(`child exit ${code}`)
        this.wanUrl = null
        this.tunnelStatus = 'starting'
        if (this.enabled && !this.stopping && !this.restartingTunnel) {
          this.restartingTunnel = true
          setTimeout(() => {
            this.restartingTunnel = false
            if (this.enabled) void this.ensureTunnel()
          }, 2500)
        }
        if (!settled) {
          this.tunnelError = `tunel padł (${code ?? '?'})`
          done()
        }
      })
      setTimeout(() => {
        if (grabUrl()) {
          clearInterval(poll)
        } else if (!this.wanUrl) {
          this.tunnelError = this.tunnelError || 'tunel jeszcze wstaje — zostaw włączone'
          this.log('tunnel waiting for public url')
        }
        done()
      }, 40000)
    })
  }

  private killTunnel(clear = true): void {
    const t = this.tunnel
    this.tunnel = null
    if (clear) {
      this.wanUrl = null
      this.tunnelStatus = 'off'
    }
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
      void this.onMessage(ws, buf.toString())
    })
    const gone = () => {
      clearInterval(beat)
      this.sockets.delete(ws)
    }
    ws.on('close', gone)
    ws.on('error', gone)
  }

  private async onMessage(ws: WebSocket, raw: string): Promise<void> {
    let cmd: RemoteCommand
    try {
      cmd = JSON.parse(raw) as RemoteCommand
    } catch {
      return
    }
    if (cmd.m === 'ping') return
    try {
      const r = await this.opts.dispatch(cmd)
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
