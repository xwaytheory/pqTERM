import { homedir } from 'os'
import { dirname } from 'path'
import { BrowserWindow } from './host'
import type { IPty } from 'node-pty'
import { specById } from './engines'
import type { EngineId } from '../shared/types'
import { resolveLaunch, sanitizeEnv, yoloEnv } from './resolve-launch'
import { trustWorkspace } from './trust'
import { runningDev } from './env'

let pty: typeof import('node-pty') | null = null

function loadPty(): typeof import('node-pty') {
  if (pty) return pty
  pty = require('node-pty') as typeof import('node-pty')
  return pty
}

export interface PtySession {
  id: string
  paneId: string
  workspaceId: string
  engine: EngineId
  proc: IPty
  alive: boolean
  /** raw output kept so the pane can be redrawn after switching workspaces / app restart */
  buf: string
  /** chunk counter — lets the renderer dedupe replay vs live stream */
  seq: number
}

const MAX_BUF = 512 * 1024

function appendBuf(prev: string, data: string): string {
  const joined = prev + data
  if (joined.length <= MAX_BUF) return joined
  let cut = joined.length - MAX_BUF
  if (cut > 0 && /[\ud800-\udbff]/.test(joined[cut - 1] ?? '')) cut -= 1
  return joined.slice(cut)
}

function envFor(
  cwd: string,
  extraPath?: string,
  engine?: EngineId,
  extraEnv?: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const env = sanitizeEnv({ ...process.env } as NodeJS.ProcessEnv)
  if (engine) Object.assign(env, yoloEnv(engine))
  if (extraEnv) Object.assign(env, extraEnv)
  const extras = [
    extraEnv?.PQ_BIN || '',
    extraPath ? dirname(extraPath) : '',
    `${homedir()}\\AppData\\Roaming\\${runningDev() ? 'pq-dev' : 'pq'}\\bin`,
    `${homedir()}\\.grok\\bin`,
    `${homedir()}\\AppData\\Roaming\\npm`,
    `${homedir()}\\AppData\\Local\\hermes\\bin`,
    // Krytyk r3: do not inject Cursor IDE bin into agent PTY PATH
  ].filter(Boolean)
  const pathKey = env.Path ? 'Path' : 'PATH'
  const current = env[pathKey] ?? ''
  env[pathKey] = [...extras, current].join(';')
  env.PATH = env[pathKey]
  env.Path = env[pathKey]
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'pq'
  env.PQ = '1'
  env.PWD = cwd
  env.FORCE_COLOR = '1'
  return env
}

function exitedInternally(proc: IPty): boolean {
  const inner = proc as IPty & { _exitCode?: number | null; _socket?: { destroyed?: boolean } }
  if (inner._exitCode !== undefined && inner._exitCode !== null) return true
  if (inner._socket?.destroyed) return true
  return false
}

export class PtyManager {
  private sessions = new Map<string, PtySession>()
  private lastBuf = new Map<string, { data: string; seq: number }>()

  constructor(
    private getWin: () => BrowserWindow | null,
    private hooks?: {
      extraEnv?: (paneId: string) => NodeJS.ProcessEnv
      onOutput?: (paneId: string, data: string) => void
      onExit?: (paneId: string) => void
    }
  ) {}

  spawn(opts: {
    paneId: string
    workspaceId: string
    engine: EngineId
    cwd: string
    cols: number
    rows: number
    resolvedPath?: string
    extraArgs?: string[]
    seedBuf?: string
  }): void {
    const live = this.sessions.get(opts.paneId)
    if (
      live?.alive &&
      !exitedInternally(live.proc) &&
      live.engine === opts.engine &&
      live.workspaceId === opts.workspaceId
    ) {
      if (opts.seedBuf && !live.buf) live.buf = appendBuf(opts.seedBuf, '')
      return
    }
    this.kill(opts.paneId)
    try {
      trustWorkspace(opts.cwd || homedir())
    } catch {
      /* ignore */
    }
    const np = loadPty()
    const spec = specById(opts.engine)
    const target = opts.resolvedPath || spec.binaries[0]
    const extra = opts.extraArgs ?? []
    const { spawnFile, args } = resolveLaunch(opts.engine, target, extra)
    const win0 = this.getWin()

    let proc: IPty
    try {
      proc = np.spawn(spawnFile, args, {
        name: 'xterm-256color',
        cols: Math.max(20, opts.cols || 80),
        rows: Math.max(8, opts.rows || 24),
        cwd: opts.cwd || homedir(),
        env: envFor(
          opts.cwd || homedir(),
          opts.resolvedPath,
          opts.engine,
          this.hooks?.extraEnv?.(opts.paneId)
        ),
        useConpty: true
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      win0?.webContents.send(
        'term:data',
        opts.paneId,
        `\x1b[31m[pq] spawn failed: ${spawnFile}\r\n${msg}\x1b[0m\r\n`
      )
      win0?.webContents.send('term:exit', opts.paneId, 1)
      return
    }

    const session: PtySession = {
      id: opts.paneId,
      paneId: opts.paneId,
      workspaceId: opts.workspaceId,
      engine: opts.engine,
      proc,
      alive: true,
      buf: opts.seedBuf ?? '',
      seq: 0
    }
    this.sessions.set(opts.paneId, session)
    this.lastBuf.set(opts.paneId, { data: session.buf, seq: session.seq })

    proc.onData((data) => {
      if (!session.alive) return
      session.seq += 1
      session.buf = appendBuf(session.buf, data)
      this.lastBuf.set(opts.paneId, { data: session.buf, seq: session.seq })
      this.hooks?.onOutput?.(opts.paneId, data)
      this.getWin()?.webContents.send('term:data', opts.paneId, data, session.seq)
    })
    proc.onExit(({ exitCode }) => {
      session.alive = false
      this.sessions.delete(opts.paneId)
      this.lastBuf.set(opts.paneId, { data: session.buf, seq: session.seq })
      this.hooks?.onExit?.(opts.paneId)
      this.getWin()?.webContents.send('term:exit', opts.paneId, exitCode ?? 0)
    })
  }

  write(paneId: string, data: string): void {
    const s = this.sessions.get(paneId)
    if (!s?.alive || exitedInternally(s.proc)) return
    try {
      s.proc.write(data)
    } catch {
      s.alive = false
    }
  }

  resize(paneId: string, cols: number, rows: number): void {
    const s = this.sessions.get(paneId)
    if (!s?.alive || exitedInternally(s.proc)) {
      if (s) {
        s.alive = false
        this.sessions.delete(paneId)
      }
      return
    }
    try {
      s.proc.resize(Math.max(20, cols), Math.max(8, rows))
    } catch {
      s.alive = false
      this.sessions.delete(paneId)
    }
  }

  kill(paneId: string): void {
    const s = this.sessions.get(paneId)
    if (!s) return
    s.alive = false
    this.sessions.delete(paneId)
    this.lastBuf.set(paneId, { data: s.buf, seq: s.seq })
    this.hooks?.onExit?.(paneId)
    try {
      s.proc.kill()
    } catch {
      /* ignore */
    }
  }

  killWorkspace(workspaceId: string): void {
    for (const s of [...this.sessions.values()]) {
      if (s.workspaceId === workspaceId) this.kill(s.paneId)
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }

  alive(paneId: string): boolean {
    const s = this.sessions.get(paneId)
    return Boolean(s?.alive && !exitedInternally(s.proc))
  }

  describe(paneId: string): { alive: boolean; engine: EngineId; workspaceId: string } | null {
    const s = this.sessions.get(paneId)
    if (!s) return null
    return {
      alive: s.alive && !exitedInternally(s.proc),
      engine: s.engine,
      workspaceId: s.workspaceId
    }
  }

  /** tail of accumulated output for a pane (also kept after the process exits) */
  buffer(paneId: string): { data: string; seq: number } {
    const s = this.sessions.get(paneId)
    if (s) return { data: s.buf, seq: s.seq }
    return this.lastBuf.get(paneId) ?? { data: '', seq: 0 }
  }

  /** feed a persisted scrollback into a fresh session without pushing it to the UI */
  seedBuffer(paneId: string, data: string): void {
    if (!data) return
    const s = this.sessions.get(paneId)
    if (s) {
      s.buf = appendBuf(s.buf, data)
      this.lastBuf.set(paneId, { data: s.buf, seq: s.seq })
    } else {
      this.lastBuf.set(paneId, { data, seq: 0 })
    }
  }
}
