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
  proc: IPty
  alive: boolean
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
    `${homedir()}\\AppData\\Local\\Programs\\cursor\\resources\\app\\bin`
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
  }): void {
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
      proc,
      alive: true
    }
    this.sessions.set(opts.paneId, session)

    proc.onData((data) => {
      if (!session.alive) return
      this.hooks?.onOutput?.(opts.paneId, data)
      this.getWin()?.webContents.send('term:data', opts.paneId, data)
    })
    proc.onExit(({ exitCode }) => {
      session.alive = false
      this.sessions.delete(opts.paneId)
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
}
