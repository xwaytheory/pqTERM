import { homedir } from 'os'
import { dirname } from 'path'
import { BrowserWindow } from './host'
import type { IPty } from 'node-pty'
import { specById } from './engines'
import type { EngineId } from '../shared/types'
import { resolveLaunch, sanitizeEnv, yoloEnv } from './resolve-launch'
import { trustWorkspace } from './trust'
import { runningDev } from './env'
import { cleanOscTitle, scanOscTitle } from './osc-title'
import { scanOscNotices, cleanNoticeText, type OscNotice } from './osc-notify'
import { appendTail } from '../shared/term-stream'
import { PTY_MIN_COLS, PTY_MIN_ROWS } from '../shared/term-geometry'

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
  /** terminal size the current buffer content was formatted for (ConPTY repaints on resize) */
  capCols: number
  capRows: number
}

function appendBuf(prev: string, data: string): string {
  // trim lives in src/shared/term-stream.ts: the head cut must not split an
  // escape sequence (see term-stream.test.ts)
  return appendTail(prev, data)
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
  const spec = engine ? specById(engine) : null
  const extraDirs = spec?.extraPathDirs?.map((d) => d.replace('%USERPROFILE%', homedir()).replace('%APPDATA%', `${homedir()}\\AppData\\Roaming`).replace('%LOCALAPPDATA%', `${homedir()}\\AppData\\Local`)) ?? []
  const extras = [
    extraEnv?.PQ_BIN || '',
    extraPath ? dirname(extraPath) : '',
    ...extraDirs,
    `${homedir()}\\AppData\\Roaming\\${runningDev() ? 'pqTERM-dev' : 'pqTERM-pr'}\\bin`,
    `${homedir()}\\.grok\\bin`,
    `${homedir()}\\AppData\\Roaming\\npm`,
    `${homedir()}\\AppData\\Local\\hermes\\bin`,
    'C:\\Program Files\\Git\\usr\\bin',
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
  private lastBuf = new Map<string, { data: string; seq: number; cols?: number; rows?: number }>()
  private gen = new Map<string, number>()
  /** per-pane partial OSC sequence carried between data chunks */
  private oscTail = new Map<string, string>()
  /** per-pane partial OSC 9/777 notification sequence carried between chunks */
  private noticeTail = new Map<string, string>()

  constructor(
    private getWin: () => BrowserWindow | null,
    private hooks?: {
      extraEnv?: (paneId: string) => NodeJS.ProcessEnv
      onStart?: (paneId: string) => void
      onOutput?: (paneId: string, data: string) => void
      onExit?: (paneId: string, exitCode: number, intentional: boolean) => void
      /** CLI set its own window title via OSC — expose it so a pane can adopt it */
      onTitle?: (paneId: string, title: string) => void
      /** CLI asked for a desktop notification via OSC 9 / OSC 777. */
      onNotice?: (paneId: string, notice: OscNotice) => void
      /** Data written to the pane (keystroke / paste / drop / bridge command). */
      onInput?: (paneId: string) => void
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
    // trustWorkspace is best-effort (swallows provider I/O errors); outer catch keeps spawn unblocked
    try {
      trustWorkspace(opts.cwd || homedir())
    } catch {
      /* ignore — never block ConPTY/pane start on trust-file write failure */
    }
    const np = loadPty()
    const spec = specById(opts.engine)
    const target = opts.resolvedPath || spec.binaries[0]
    const extra = opts.extraArgs ?? []
    const { spawnFile, args } = resolveLaunch(opts.engine, target, extra)
    const win0 = this.getWin()

    let proc: IPty
    // Same floor on both sides: a pane below it never fits (renderer guard),
    // so these constants only stop a stale/buggy renderer from driving ConPTY
    // into a ~2-column reflow (TUI smeared one letter per line).
    const capCols = Math.max(PTY_MIN_COLS, opts.cols || 80)
    const capRows = Math.max(PTY_MIN_ROWS, opts.rows || 24)
    try {
      proc = np.spawn(spawnFile, args, {
        name: 'xterm-256color',
        cols: capCols,
        rows: capRows,
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
      this.hooks?.onStart?.(opts.paneId)
      this.hooks?.onExit?.(opts.paneId, 1, false)
      win0?.webContents.send(
        'term:data',
        opts.paneId,
        `\x1b[31m[pqTERM] spawn failed: ${spawnFile}\r\n${msg}\x1b[0m\r\n`
      )
      win0?.webContents.send('term:exit', opts.paneId, 1)
      return
    }

    const generation = (this.gen.get(opts.paneId) ?? 0) + 1
    this.gen.set(opts.paneId, generation)
    const session: PtySession = {
      id: opts.paneId,
      paneId: opts.paneId,
      workspaceId: opts.workspaceId,
      engine: opts.engine,
      proc,
      alive: true,
      buf: opts.seedBuf ?? '',
      seq: 0,
      // Geometry the live tail was drawn at = the PTY's own size. A persisted
      // seed keeps its older geometry, but reporting that as current would make
      // the renderer believe the PTY already sits there and skip the resize that
      // triggers the ConPTY repaint — the replay then stays reflowed/glued.
      capCols,
      capRows
    }
    this.sessions.set(opts.paneId, session)
    this.lastBuf.set(opts.paneId, { data: session.buf, seq: session.seq, cols: capCols, rows: capRows })
    this.hooks?.onStart?.(opts.paneId)

    proc.onData((data) => {
      if (!session.alive) return
      session.seq += 1
      session.buf = appendBuf(session.buf, data)
      this.lastBuf.set(opts.paneId, { data: session.buf, seq: session.seq, cols: session.capCols, rows: session.capRows })
      const acc = (this.oscTail.get(opts.paneId) ?? '') + data
      const [oscTitle, keep] = scanOscTitle(acc)
      this.oscTail.set(opts.paneId, keep)
      if (oscTitle) {
        const clean = cleanOscTitle(oscTitle)
        if (clean) this.hooks?.onTitle?.(opts.paneId, clean)
      }
      // OSC 9 / OSC 777: the CLI explicitly asked the terminal to notify the
      // user (completion / needs attention). Same cross-chunk-safe scanning as
      // titles; both sequences pass through ConPTY as plain output.
      const noticeTail = (this.noticeTail.get(opts.paneId) ?? '') + data
      const [allNotices, nk] = scanOscNotices(noticeTail)
      this.noticeTail.set(opts.paneId, nk)
      for (const n of allNotices) {
        const body = cleanNoticeText(n.body)
        if (body) this.hooks?.onNotice?.(opts.paneId, { title: cleanNoticeText(n.title), body })
      }
      this.hooks?.onOutput?.(opts.paneId, data)
      this.getWin()?.webContents.send('term:data', opts.paneId, data, session.seq)
    })
    proc.onExit(({ exitCode }) => {
      if (this.gen.get(opts.paneId) !== generation) return
      if (this.sessions.get(opts.paneId) !== session) return
      session.alive = false
      this.sessions.delete(opts.paneId)
      this.oscTail.delete(opts.paneId)
      this.lastBuf.set(opts.paneId, { data: session.buf, seq: session.seq, cols: session.capCols, rows: session.capRows })
      this.hooks?.onExit?.(opts.paneId, exitCode ?? 0, false)
      this.getWin()?.webContents.send('term:exit', opts.paneId, exitCode ?? 0)
    })
  }

  write(paneId: string, data: string): void {
    const s = this.sessions.get(paneId)
    if (!s?.alive || exitedInternally(s.proc)) return
    try {
      s.proc.write(data)
      if (data) this.hooks?.onInput?.(paneId)
    } catch {
      s.alive = false
    }
  }

  resize(paneId: string, cols: number, rows: number): void {
    const s = this.sessions.get(paneId)
    if (!s?.alive || exitedInternally(s.proc)) {
      if (s) {
        s.alive = false
      }
      return
    }
    try {
      // Keep the PTY exactly as wide as xterm — but never below the floor:
      // a 2-column ConPTY reflow is what smears a TUI into vertical letter
      // soup, and the renderer's dedupe would then never re-send a sane size.
      const c = Math.max(PTY_MIN_COLS, cols)
      const r = Math.max(PTY_MIN_ROWS, rows)
      s.proc.resize(c, r)
      // ConPTY repaints the whole screen after a resize, so the buffer tail is
      // now formatted for the new size — replay must know it.
      s.capCols = c
      s.capRows = r
      this.lastBuf.set(paneId, { data: s.buf, seq: s.seq, cols: c, rows: r })
    } catch {
      s.alive = false
    }
  }

  kill(paneId: string): void {
    const s = this.sessions.get(paneId)
    if (!s) {
      this.hooks?.onExit?.(paneId, 0, true)
      return
    }
    s.alive = false
    this.sessions.delete(paneId)
    this.oscTail.delete(paneId)
    this.noticeTail.delete(paneId)
    this.lastBuf.set(paneId, { data: s.buf, seq: s.seq, cols: s.capCols, rows: s.capRows })
    this.hooks?.onExit?.(paneId, 0, true)
    try {
      s.proc.kill()
    } catch {
      /* ignore */
    }
    const w = this.getWin()
    if (w && !w.isDestroyed()) w.webContents.send('term:exit', paneId, 0)
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
  buffer(paneId: string): { data: string; seq: number; cols?: number; rows?: number } {
    const s = this.sessions.get(paneId)
    if (s) return { data: s.buf, seq: s.seq, cols: s.capCols, rows: s.capRows }
    return this.lastBuf.get(paneId) ?? { data: '', seq: 0 }
  }

  /** feed a persisted scrollback into a fresh session without pushing it to the UI */
  seedBuffer(paneId: string, data: string): void {
    if (!data) return
    const s = this.sessions.get(paneId)
    if (s) {
      s.buf = appendBuf(s.buf, data)
      this.lastBuf.set(paneId, { data: s.buf, seq: s.seq, cols: s.capCols, rows: s.capRows })
    } else {
      this.lastBuf.set(paneId, { data, seq: 0 })
    }
  }
}
