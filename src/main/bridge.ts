import { createServer, type Server } from 'http'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { runningDev } from './env'

export const PQ_HINT =
  'You are inside pqTERM, a Windows terminal grid. Sibling panes are NOT Windows Terminal. Control them with the pqterm command (on PATH): `pqterm list` · `pqterm fill grok` · `pqterm spawn 2 grok` · `pqterm send 2 Siemanko`. Never run wt, conhost, or start to open extra terminals.'

export function binDir(): string {
  return join(homedir(), 'AppData', 'Roaming', runningDev() ? 'pqTERM-dev' : 'pqTERM-pr', 'bin')
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

const CTL = `const { readFileSync, existsSync } = require('fs')
const { join } = require('path')

function loadBridge() {
  if (process.env.PQ_BRIDGE && process.env.PQ_TOKEN) {
    return { origin: process.env.PQ_BRIDGE, token: process.env.PQ_TOKEN }
  }
  const f = join(__dirname, 'bridge.json')
  if (!existsSync(f)) {
    console.error('pq: brak mostka — odpal najpierw aplikację pq')
    process.exit(1)
  }
  return JSON.parse(readFileSync(f, 'utf8'))
}

async function call(method, path, body) {
  const b = loadBridge()
  const res = await fetch(b.origin + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-PQ-Token': b.token
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!res.ok) {
    console.error(json.error || text)
    process.exit(1)
  }
  return json
}

function help() {
  console.log(\`pqterm — sterowanie siatką z wnętrza CLI

  pqterm list
  pqterm fill [engine]              idle sloty → silnik (domyślnie grok)
  pqterm fill grok --send Siemanko  fill + ten sam prompt w nowych oknach
  pqterm spawn <slot> [engine]      slot 1..N
  pqterm send <slot> <tekst...>     wyślij prompt + Enter
\`)
}

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    help()
    return
  }
  if (cmd === 'list') {
    const data = await call('GET', '/v1/panes')
    for (const p of data.panes) {
      const st = p.engine ? p.engine : 'idle'
      console.log(String(p.slot).padStart(2) + '  ' + st.padEnd(10) + '  ' + (p.title || ''))
    }
    return
  }
  if (cmd === 'fill') {
    const rest = argv.slice(1)
    const sendAt = rest.indexOf('--send')
    let engine = 'grok'
    let prompt = ''
    if (sendAt >= 0) {
      engine = rest[0] && rest[0] !== '--send' ? rest[0] : 'grok'
      prompt = rest.slice(sendAt + 1).join(' ')
    } else if (rest[0]) engine = rest[0]
    const skip = process.env.PQ_SLOT ? Number(process.env.PQ_SLOT) : 0
    const data = await call('POST', '/v1/fill', { engine, prompt, skipSlot: skip })
    console.log(data.ok ? 'ok  ' + (data.spawned || []).join(',') : 'fail')
    return
  }
  if (cmd === 'spawn') {
    const slot = Number(argv[1])
    const engine = argv[2] || 'grok'
    if (!slot) { console.error('pqterm spawn <slot> [engine]'); process.exit(1) }
    await call('POST', '/v1/panes/' + slot + '/spawn', { engine })
    console.log('ok')
    return
  }
  if (cmd === 'send') {
    const slot = Number(argv[1])
    const text = argv.slice(2).join(' ')
    if (!slot || !text) { console.error('pqterm send <slot> <tekst>'); process.exit(1) }
    await call('POST', '/v1/panes/' + slot + '/write', { text })
    console.log('ok')
    return
  }
  help()
  process.exit(1)
}

main().catch((e) => { console.error(String(e && e.message ? e.message : e)); process.exit(1) })
`

export class PaneBridge {
  token = randomBytes(16).toString('hex')
  origin = ''
  private server: Server | null = null

  constructor(
    private hooks: {
      list: () => { slot: number; paneId: string; engine: string | null; title: string }[]
      spawn: (slot: number, engine: string) => Promise<string | null>
      write: (slot: number, text: string) => Promise<boolean>
      fill: (engine: string, prompt: string, skipSlot: number) => Promise<number[]>
    }
  ) {}

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
    this.install()
    this.server = createServer((req, res) => {
      void this.handle(req, res)
    })
    this.server.listen(0, '127.0.0.1', () => {
      const addr = this.server?.address()
      const port = addr && typeof addr === 'object' ? addr.port : 0
      this.origin = `http://127.0.0.1:${port}`
      const dir = binDir()
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'bridge.json'),
        JSON.stringify({ origin: this.origin, token: this.token }, null, 2),
        'utf8'
      )
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
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
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const token = String(req.headers['x-pq-token'] || '')
    if (token !== this.token) return send(401, { error: 'bad token' })
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const bufs: Buffer[] = []
    for await (const c of req) bufs.push(c as Buffer)
    let body: Record<string, unknown> = {}
    if (bufs.length) {
      try {
        body = JSON.parse(Buffer.concat(bufs).toString('utf8')) as Record<string, unknown>
      } catch {
        body = {}
      }
    }
    try {
      if (req.method === 'GET' && url.pathname === '/v1/panes') {
        return send(200, { panes: this.hooks.list() })
      }
      const spawnM = url.pathname.match(/^\/v1\/panes\/(\d+)\/spawn$/)
      if (req.method === 'POST' && spawnM) {
        const paneId = await this.hooks.spawn(Number(spawnM[1]), String(body.engine || 'grok'))
        return send(paneId ? 200 : 404, paneId ? { ok: true, paneId } : { error: 'no slot' })
      }
      const writeM = url.pathname.match(/^\/v1\/panes\/(\d+)\/write$/)
      if (req.method === 'POST' && writeM) {
        const ok = await this.hooks.write(Number(writeM[1]), String(body.text || ''))
        return send(ok ? 200 : 404, { ok })
      }
      if (req.method === 'POST' && url.pathname === '/v1/fill') {
        const spawned = await this.hooks.fill(
          String(body.engine || 'grok'),
          String(body.prompt || ''),
          Number(body.skipSlot || 0)
        )
        return send(200, { ok: true, spawned })
      }
      send(404, { error: 'unknown' })
    } catch (err) {
      send(500, { error: err instanceof Error ? err.message : String(err) })
    }
  }
}
