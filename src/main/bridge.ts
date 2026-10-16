import { createServer, type Server } from 'http'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { randomBytes, timingSafeEqual } from 'crypto'
import { runningDev, profileDirName } from './env.ts'
import { CTL } from './pqterm-ctl.ts'

/** Bridge bodies are tiny JSON commands — anything bigger is junk (or a local DoS). */
const BRIDGE_MAX_BODY = 65536

/** Timing-safe token check, mirrors RemoteHub.safeEqual. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

export const PQ_HINT =
  'You are inside pqTERM, a Windows terminal grid. Sibling panes are NOT Windows Terminal. Control them with the pqterm command (on PATH): `pqterm list` · `pqterm fill grok` · `pqterm spawn 2 grok` · `pqterm send 2 Siemanko`. Never run wt, conhost, or start to open extra terminals.'

export function binDir(): string {
  return join(homedir(), 'AppData', 'Roaming', profileDirName(), 'bin')
}

function findNode(): string {
  const pathEnv = process.env.Path || process.env.PATH || ''
  for (const dir of pathEnv.split(';')) {
    if (!dir) continue
    const p = join(dir, 'node.exe')
    if (existsSync(p)) return p
  }
  const fallback = join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe')
  return existsSync(fallback) ? fallback : 'node'
}


type PaneBridgeHooks = {
  list: () => { slot: number; paneId: string; engine: string | null; title: string }[]
  spawn: (slot: number, engine: string) => Promise<string | null>
  write: (slot: number, text: string) => Promise<boolean>
  fill: (engine: string, prompt: string, skipSlot: number) => Promise<number[]>
  updaterSource?: string
}

export class PaneBridge {
  token = randomBytes(16).toString('hex')
  origin = ''
  private server: Server | null = null

  private hooks: PaneBridgeHooks
  constructor(hooks: PaneBridgeHooks) {
    this.hooks = hooks
  }

  install(): void {
    const dir = binDir()
    mkdirSync(dir, { recursive: true })
    const node = findNode()
    writeFileSync(
      join(dir, 'pqterm.cmd'),
      `@echo off\r\n"${node}" "%~dp0pqterm-ctl.cjs" %*\r\n`,
      'utf8'
    )
    writeFileSync(join(dir, 'pqterm-ctl.cjs'), CTL, 'utf8')
    // one-time cleanup of the pre-rebrand helper names
    for (const legacy of ['pq.cmd', 'pq-ctl.cjs']) {
      try {
        unlinkSync(join(dir, legacy))
      } catch {
        /* ignore */
      }
    }
    writeFileSync(
      join(dir, 'wt.cmd'),
      `@echo off\r\necho [pqTERM] to nie Windows Terminal.\r\necho   pqterm list\r\necho   pqterm fill grok\r\necho   pqterm send 2 Siemanko\r\nexit /b 1\r\n`,
      'utf8'
    )
  }

  start(): void {
    if (this.server) return
    this.install()
    const server = createServer((req, res) => {
      if (this.server !== server) {
        res.writeHead(503)
        res.end()
        return
      }
      void this.handle(req, res).catch(() => {
        if (res.destroyed || res.writableEnded) return
        if (res.headersSent) return res.destroy()
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid request' }))
      })
    })
    this.server = server
    server.on('error', (err) => {
      console.error('pqTERM bridge:', err)
      if (this.server === server) this.stop()
    })
    server.listen(0, '127.0.0.1', () => {
      if (this.server !== server) { server.close(); return }
      const addr = server.address()
      if (!addr || typeof addr !== 'object') return
      this.origin = `http://127.0.0.1:${addr.port}`
      try {
        const dir = binDir()
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'bridge.json'),
          JSON.stringify({ origin: this.origin, token: this.token, updater: this.hooks.updaterSource }, null, 2), 'utf8')
      } catch (err) {
        console.error('pqTERM bridge:', err)
        this.stop()
      }
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.origin = ''
  }

  envFor(paneId: string, slot: number): NodeJS.ProcessEnv {
    return {
      PQ_SLOT: String(slot),
      PQ_BRIDGE: this.origin,
      PQ_TOKEN: this.token,
      PQ_BIN: binDir()
    }
  }

  private async handle(
    req: import('http').IncomingMessage,
    res: import('http').ServerResponse
  ): Promise<void> {
    const server = this.server
    const send = (code: number, body: unknown) => {
      if (res.destroyed || res.writableEnded) return
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const token = String(req.headers['x-pq-token'] || '')
    if (!safeEqual(token, this.token)) return send(401, { error: 'bad token' })
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const bufs: Buffer[] = []
    let size = 0
    for await (const c of req) {
      size += (c as Buffer).length
      if (size > BRIDGE_MAX_BODY) {
        send(413, { error: 'body too large' })
        req.destroy()
        return
      }
      bufs.push(c as Buffer)
    }
    if (!server || this.server !== server) return send(503, { error: 'bridge stopped' })
    let body: Record<string, unknown> = {}
    if (bufs.length) {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(bufs).toString('utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return send(400, { error: 'expected object' })
        }
        body = parsed as Record<string, unknown>
      } catch {
        return send(400, { error: 'invalid JSON' })
      }
    }
    if (req.method === 'POST' && !bufs.length) return send(400, { error: 'expected JSON body' })
    if (body.engine !== undefined && (typeof body.engine !== 'string' || !body.engine.trim())) {
      return send(400, { error: 'invalid engine' })
    }
    try {
      if (req.method === 'GET' && url.pathname === '/v1/panes') {
        return send(200, { panes: this.hooks.list() })
      }
      const spawnM = url.pathname.match(/^\/v1\/panes\/(\d+)\/spawn$/)
      if (req.method === 'POST' && spawnM) {
        const slot = Number(spawnM[1])
        if (!Number.isSafeInteger(slot) || slot < 1) return send(400, { error: 'invalid slot' })
        const paneId = await this.hooks.spawn(slot, (body.engine as string | undefined) ?? 'grok')
        return send(paneId ? 200 : 404, paneId ? { ok: true, paneId } : { error: 'no slot' })
      }
      const writeM = url.pathname.match(/^\/v1\/panes\/(\d+)\/write$/)
      if (req.method === 'POST' && writeM) {
        const slot = Number(writeM[1])
        if (!Number.isSafeInteger(slot) || slot < 1 || typeof body.text !== 'string') {
          return send(400, { error: 'invalid slot or text' })
        }
        const ok = await this.hooks.write(slot, body.text)
        return send(ok ? 200 : 404, { ok })
      }
      if (req.method === 'POST' && url.pathname === '/v1/fill') {
        if ((body.prompt !== undefined && typeof body.prompt !== 'string') ||
            (body.skipSlot !== undefined && (typeof body.skipSlot !== 'number' ||
              !Number.isSafeInteger(body.skipSlot) || body.skipSlot < 0))) {
          return send(400, { error: 'invalid prompt or skipSlot' })
        }
        const spawned = await this.hooks.fill(
          (body.engine as string | undefined) ?? 'grok',
          (body.prompt as string | undefined) ?? '',
          (body.skipSlot as number | undefined) ?? 0
        )
        return send(200, { ok: true, spawned })
      }
      send(404, { error: 'unknown' })
    } catch (err) {
      send(500, { error: err instanceof Error ? err.message : String(err) })
    }
  }
}
