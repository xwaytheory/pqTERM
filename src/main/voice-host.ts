/**
 * Electron main → pq-voice.exe spawn sketch (opt-in).
 *
 * Mirrors `pq_core::ipc::VoiceHostSpawnPlan` / `voice_exe_candidates`.
 * Overnight default: OFF. Production path unchanged unless:
 *   - process.env.PQ_VOICE_HOST === '1', OR
 *   - spawnVoiceHost({ enabled: true, ... }) is called explicitly.
 *
 * Host listens BEFORE spawn (pq-voice connects; Electron / pq-work listens):
 *   - Windows pipe: \\.\pipe\pq-voice-{sanitizedSession}
 *   - TCP: 127.0.0.1:4791 (or opts.tcpAddr)
 * Peer Socket kept on the active handle for Cancel / StartListen JSON-lines + best-effort Status/Transcript reader.
 *
 * Do NOT import this into app.whenReady / UI click paths without the gate.
 * Never passes --allow-download (missing GGML = error, not a 3 GB fetch).
 *
 * Quit lifecycle: successful spawn registers a module-level active handle;
 * `shutdownVoiceHost()` (wired from `app.on('before-quit')`) is a no-op when
 * nothing was ever spawned. Cancel / StartListen write one JSON line when a writable peer
 * socket exists; otherwise return false honestly (no pretend success).
 * Status/Transcript inbound: non-blocking line buffer on socket data (never blocks before-quit).
 *
 * See docs/VOICE-HOST-BRIDGE.md
 */
import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { createServer, type Server, type Socket } from 'net'
import { dirname, join } from 'path'

/** Mirrors pq_core::ipc::VOICE_EXE_NAME */
export const VOICE_EXE_NAME = 'pq-voice.exe'

/** Mirrors pq_core::ipc::DEFAULT_TCP_ADDR */
export const DEFAULT_TCP_ADDR = '127.0.0.1:4791'

/** Mirrors pq_core::ipc::PIPE_NAME_PREFIX */
export const PIPE_NAME_PREFIX = '\\\\.\\pipe\\pq-voice-'

/** Mirrors VoiceHostSpawnPlan.search_rel (Windows-style + posix join) */
export const VOICE_SEARCH_REL = [
  VOICE_EXE_NAME,
  join('resources', VOICE_EXE_NAME),
  join('extraResources', VOICE_EXE_NAME)
] as const

/** Env gate — only '1' enables. */
export const PQ_VOICE_HOST_ENV = 'PQ_VOICE_HOST'

/** Grace period before SIGKILL on win32 after orderly kill (ms). */
export const VOICE_HOST_KILL_GRACE_MS = 800

export type VoiceTransport = 'ipc-pipe' | 'ipc-tcp'

export type VoiceHostSpawnOk = {
  ok: true
  child: ChildProcess
  exe: string
  args: string[]
  transport: VoiceTransport
  sessionId: string
  /** Windows named-pipe path when transport is ipc-pipe. */
  pipePath?: string
  /** Bound TCP address when transport is ipc-tcp. */
  listenAddr?: string
}

export type VoiceHostSpawnErr = {
  ok: false
  code: 'disabled' | 'missing-exe' | 'bad-session' | 'spawn-failed' | 'listen-failed'
  message: string
  candidates?: string[]
}

export type VoiceHostSpawnResult = VoiceHostSpawnOk | VoiceHostSpawnErr

export type SpawnVoiceHostOpts = {
  sessionId: string
  /** Explicit opt-in. If omitted, only PQ_VOICE_HOST=1 enables. */
  enabled?: boolean
  /** App / install root(s). Defaults from process.execPath + resourcesPath. */
  appDirs?: string[]
  /** TCP fallback address (non-Windows or when preferPipe=false). */
  tcpAddr?: string
  /** Prefer named pipe on win32 (default true on win32). */
  preferPipe?: boolean
}

/** Tracked active child — set on successful spawn, cleared on stop/shutdown/exit. */
export type VoiceIpcStatus = {
  type: 'status'
  source: string
  state: string
  detail?: string | null
  session_id?: string | null
}

export type VoiceIpcTranscript = {
  type: 'transcript'
  session_id: string
  text: string
  lang?: string | null
  is_final: boolean
}

/** Cap inbound transcripts kept on the active handle (best-effort ring). */
export const VOICE_HOST_TRANSCRIPT_CAP = 32

export type ActiveVoiceHost = {
  child: ChildProcess
  sessionId: string
  transport: VoiceTransport
  exe: string
  /** Node listen server (pipe or TCP); closed on shutdown. */
  server: Server | null
  /** Peer duplex after pq-voice connects; used for Cancel / StartListen JSON-line. */
  socket: Socket | null
  pipePath?: string
  listenAddr?: string
  /** Last parsed Status from peer (best-effort). */
  lastStatus: VoiceIpcStatus | null
  /** Recent Transcript messages from peer (capped). */
  lastTranscripts: VoiceIpcTranscript[]
  /** Incomplete trailing line from socket data buffer. */
  _lineBuf?: string
}

let activeVoiceHost: ActiveVoiceHost | null = null

export function isVoiceHostEnvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PQ_VOICE_HOST_ENV] === '1'
}

export function isVoiceHostEnabled(opts: { enabled?: boolean }, env: NodeJS.ProcessEnv = process.env): boolean {
  return opts.enabled === true || isVoiceHostEnvEnabled(env)
}

/** ASCII alnum / - / _ ; max 64 — mirrors sanitize_pipe_session_id. */
export function sanitizePipeSessionId(sessionId: string): { ok: true; id: string } | { ok: false; message: string } {
  if (!sessionId) return { ok: false, message: 'empty pipe session id' }
  if (sessionId.length > 64) return { ok: false, message: 'pipe session id longer than 64' }
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    return { ok: false, message: "pipe session id must be ASCII alphanumeric, '-' or '_'" }
  }
  return { ok: true, id: sessionId }
}

/** Mirrors pq_core::ipc::named_pipe_path — `\\.\pipe\pq-voice-{session}`. */
export function namedPipePath(sessionId: string): string {
  return `${PIPE_NAME_PREFIX}${sessionId}`
}

/**
 * Candidate exe paths under one app dir — mirrors voice_exe_candidates(app_dir).
 */
export function voiceExeCandidates(appDir: string): string[] {
  return VOICE_SEARCH_REL.map((rel) => join(appDir, rel))
}

/**
 * Default search roots: same dir as host exe, process.resourcesPath parent-ish,
 * and (dev only) crates/target/debug — never ship the debug path.
 */
export function defaultVoiceAppDirs(): string[] {
  const dirs: string[] = []
  try {
    if (process.execPath) dirs.push(dirname(process.execPath))
  } catch {
    /* ignore */
  }
  if (process.resourcesPath) {
    dirs.push(process.resourcesPath)
    dirs.push(dirname(process.resourcesPath))
  }
  // Dev: workspace crates/target/debug (last resort; docs: never ship)
  const cwd = process.cwd()
  dirs.push(join(cwd, 'crates', 'target', 'debug'))
  dirs.push(join(cwd, 'target', 'debug'))
  return [...new Set(dirs.filter(Boolean))]
}

export function resolveVoiceExe(appDirs: string[] = defaultVoiceAppDirs()): {
  exe: string | null
  candidates: string[]
} {
  const candidates: string[] = []
  for (const dir of appDirs) {
    for (const p of voiceExeCandidates(dir)) {
      candidates.push(p)
      if (existsSync(p)) return { exe: p, candidates }
    }
  }
  return { exe: null, candidates }
}

export function buildVoiceHostArgs(opts: {
  sessionId: string
  tcpAddr?: string
  preferPipe?: boolean
  platform?: NodeJS.Platform
}): { ok: true; args: string[]; transport: VoiceTransport } | { ok: false; message: string } {
  const platform = opts.platform ?? process.platform
  const preferPipe = opts.preferPipe ?? platform === 'win32'
  if (preferPipe && platform === 'win32') {
    const s = sanitizePipeSessionId(opts.sessionId)
    if (!s.ok) return { ok: false, message: s.message }
    return { ok: true, args: ['--ipc-pipe', s.id], transport: 'ipc-pipe' }
  }
  const addr = opts.tcpAddr || DEFAULT_TCP_ADDR
  return { ok: true, args: ['--ipc-tcp', addr], transport: 'ipc-tcp' }
}

function destroyIpc(handle: ActiveVoiceHost): void {
  try {
    if (handle.socket && !handle.socket.destroyed) handle.socket.destroy()
  } catch {
    /* ignore */
  }
  handle.socket = null
  try {
    if (handle.server) handle.server.close()
  } catch {
    /* ignore */
  }
  handle.server = null
}

function clearActiveIfMatch(child: ChildProcess): void {
  if (activeVoiceHost?.child === child) {
    destroyIpc(activeVoiceHost)
    activeVoiceHost = null
  }
}

function registerActive(handle: ActiveVoiceHost): void {
  // Replace prior active without pretending Cancel was sent — caller owns lifecycle.
  if (activeVoiceHost && activeVoiceHost.child !== handle.child) {
    const prev = activeVoiceHost
    activeVoiceHost = null
    destroyIpc(prev)
    try {
      if (!prev.child.killed) prev.child.kill()
    } catch {
      /* ignore */
    }
  }
  activeVoiceHost = handle
  handle.child.once('exit', () => clearActiveIfMatch(handle.child))
  handle.child.once('error', () => clearActiveIfMatch(handle.child))
}

/** Snapshot of the tracked voice-host child, or null if none / already cleared. */
export function getActiveVoiceHost(): ActiveVoiceHost | null {
  return activeVoiceHost
}

/**
 * Test/smoke hook only — inject a fake active handle (or clear).
 * Do not call from production UI / whenReady paths.
 */
export function setActiveVoiceHostForTest(handle: ActiveVoiceHost | null): void {
  if (handle) {
    ensureHandleIpcFields(handle)
    if (handle.socket && !handle.socket.destroyed) {
      attachVoiceHostSocketReader(handle, handle.socket)
    }
  }
  activeVoiceHost = handle
}

/**
 * Encode a Cancel JSON line matching Rust `IpcMessage::Cancel` / `encode_line`
 * (`{"type":"cancel","session_id":"...","reason":...}`). No trailing newline —
 * callers append `\n` when writing (same as Rust).
 */
export function encodeCancelLine(sessionId: string, reason?: string): string {
  const body: { type: 'cancel'; session_id: string; reason?: string } = {
    type: 'cancel',
    session_id: sessionId
  }
  if (reason !== undefined) body.reason = reason
  return JSON.stringify(body)
}

export type EncodeStartListenOpts = {
  /** BCP-47 / Whisper hint — default "pl" (matches Rust default_lang). */
  language?: string
  /** 0 = unlimited stub (Rust default). */
  timeoutMs?: number
}

/**
 * Encode a StartListen JSON line matching Rust `IpcMessage::StartListen` /
 * `encode_line` (`{"type":"start_listen","session_id","language","timeout_ms"}`).
 * No trailing newline — callers append `\n` when writing.
 */
export function encodeStartListenLine(
  sessionId: string,
  opts: EncodeStartListenOpts = {}
): string {
  return JSON.stringify({
    type: 'start_listen',
    session_id: sessionId,
    language: opts.language ?? 'pl',
    timeout_ms: opts.timeoutMs ?? 0
  })
}

function writeJsonLineOnHandle(handle: ActiveVoiceHost, lineWithoutNl: string): boolean {
  const sock = handle.socket
  if (!sock || sock.destroyed || !sock.writable) return false
  try {
    sock.write(lineWithoutNl + String.fromCharCode(10))
    return true
  } catch {
    return false
  }
}

function writeCancelOnHandle(handle: ActiveVoiceHost, reason?: string): boolean {
  return writeJsonLineOnHandle(handle, encodeCancelLine(handle.sessionId, reason))
}

function writeStartListenOnHandle(handle: ActiveVoiceHost, opts?: EncodeStartListenOpts): boolean {
  return writeJsonLineOnHandle(handle, encodeStartListenLine(handle.sessionId, opts))
}

/**
 * Best-effort parse of one inbound JSON line. Never throws — partial / unknown = ignored.
 */
export function ingestVoiceHostIpcLine(handle: ActiveVoiceHost, rawLine: string): void {
  const trimmed = rawLine.trim()
  if (!trimmed) return
  let msg: unknown
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return
  }
  if (!msg || typeof msg !== 'object') return
  const m = msg as Record<string, unknown>
  if (m.type === 'status' && typeof m.source === 'string' && typeof m.state === 'string') {
    handle.lastStatus = {
      type: 'status',
      source: m.source,
      state: m.state,
      detail: (m.detail as string | null | undefined) ?? null,
      session_id: (m.session_id as string | null | undefined) ?? null
    }
    return
  }
  if (
    m.type === 'transcript' &&
    typeof m.session_id === 'string' &&
    typeof m.text === 'string' &&
    typeof m.is_final === 'boolean'
  ) {
    const t: VoiceIpcTranscript = {
      type: 'transcript',
      session_id: m.session_id,
      text: m.text,
      lang: (m.lang as string | null | undefined) ?? null,
      is_final: m.is_final
    }
    handle.lastTranscripts.push(t)
    if (handle.lastTranscripts.length > VOICE_HOST_TRANSCRIPT_CAP) {
      handle.lastTranscripts.splice(0, handle.lastTranscripts.length - VOICE_HOST_TRANSCRIPT_CAP)
    }
  }
}

/**
 * Non-blocking line reader on the peer socket. Buffers partial lines; never awaits /
 * never blocks before-quit. Safe to call once per socket.
 */
export function attachVoiceHostSocketReader(handle: ActiveVoiceHost, sock: Socket): void {
  handle._lineBuf = handle._lineBuf ?? ''
  const onData = (buf: Buffer | string) => {
    try {
      const chunk = typeof buf === 'string' ? buf : buf.toString('utf8')
      handle._lineBuf = (handle._lineBuf ?? '') + chunk
      let nl: number
      while ((nl = handle._lineBuf.indexOf('\n')) >= 0) {
        const line = handle._lineBuf.slice(0, nl)
        handle._lineBuf = handle._lineBuf.slice(nl + 1)
        ingestVoiceHostIpcLine(handle, line)
      }
    } catch {
      /* best-effort — never throw into the event loop */
    }
  }
  sock.on('data', onData)
}

function ensureHandleIpcFields(handle: ActiveVoiceHost): void {
  if (handle.lastStatus === undefined) handle.lastStatus = null
  if (!Array.isArray(handle.lastTranscripts)) handle.lastTranscripts = []
}

/**
 * Best-effort IPC Cancel over the held peer Socket (not stdin).
 *
 * Honesty:
 * - Spawn uses `stdio: ['ignore', 'pipe', 'pipe']` so Cancel **cannot** go via stdin.
 * - Returns `true` only when a writable peer socket is on the active handle and write succeeds.
 * - Returns `false` when inactive, peer not connected yet, or write fails — never pretend success.
 */
export function trySendCancelToActiveVoiceHost(reason?: string): boolean {
  const active = activeVoiceHost
  if (!active) return false
  return writeCancelOnHandle(active, reason)
}

/**
 * Best-effort IPC StartListen over the held peer Socket.
 * Honesty: returns true only when writable peer socket exists and write succeeds;
 * false when inactive / not connected / write fails — never pretend success.
 * Language defaults to "pl"; timeout_ms defaults to 0.
 */
export function trySendStartListenToActiveVoiceHost(opts?: EncodeStartListenOpts): boolean {
  const active = activeVoiceHost
  if (!active) return false
  return writeStartListenOnHandle(active, opts)
}

/** Alias — same honesty contract as trySendStartListenToActiveVoiceHost. */
export function sendStartListen(opts?: EncodeStartListenOpts): boolean {
  return trySendStartListenToActiveVoiceHost(opts)
}

/**
 * Stop the tracked voice-host child if any. Safe no-op when never spawned.
 *
 * Order: attempt Cancel on held socket (honest false if none), destroy socket/server,
 * then orderly `child.kill()`, then on win32 `kill('SIGKILL')` after
 * {@link VOICE_HOST_KILL_GRACE_MS} if still alive. Never kills unrelated PIDs.
 */
export function shutdownVoiceHost(): void {
  const active = activeVoiceHost
  if (!active) return

  // Clear first so re-entrant before-quit / exit handlers are no-ops.
  activeVoiceHost = null

  // Cancel over held duplex — honest skip when no peer socket yet.
  void writeCancelOnHandle(active, 'host-shutdown')

  destroyIpc(active)

  const { child } = active
  try {
    if (child.killed || child.exitCode !== null) return
    child.kill()
  } catch {
    /* ignore */
  }

  if (process.platform === 'win32') {
    const t = setTimeout(() => {
      try {
        if (!child.killed && child.exitCode === null) child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, VOICE_HOST_KILL_GRACE_MS)
    // Do not keep the Electron process alive solely for this timer.
    t.unref?.()
  }
}

function parseTcpAddr(addr: string): { host: string; port: number } {
  const idx = addr.lastIndexOf(':')
  if (idx <= 0) return { host: '127.0.0.1', port: 4791 }
  const host = addr.slice(0, idx) || '127.0.0.1'
  const port = Number(addr.slice(idx + 1)) || 4791
  return { host, port }
}

/**
 * Bind IPC listen endpoint BEFORE spawning pq-voice (which connects).
 * Pipe: \\.\pipe\pq-voice-{session}. TCP: 127.0.0.1:4791 (or override).
 */
export function listenVoiceIpc(opts: {
  transport: VoiceTransport
  sessionId: string
  tcpAddr?: string
}): Promise<{ server: Server; pipePath?: string; listenAddr?: string }> {
  const { transport, sessionId } = opts
  return new Promise((resolve, reject) => {
    const server = createServer()
    const onErr = (err: Error) => {
      try {
        server.close()
      } catch {
        /* ignore */
      }
      reject(err)
    }
    server.once('error', onErr)

    if (transport === 'ipc-pipe') {
      const pipePath = namedPipePath(sessionId)
      server.listen(pipePath, () => {
        server.removeListener('error', onErr)
        resolve({ server, pipePath })
      })
      return
    }

    const listenAddr = opts.tcpAddr || DEFAULT_TCP_ADDR
    const { host, port } = parseTcpAddr(listenAddr)
    server.listen(port, host, () => {
      server.removeListener('error', onErr)
      resolve({ server, listenAddr })
    })
  })
}

/**
 * Spawn pq-voice.exe after the host IPC server is listening.
 * Never throws for missing binary / disabled / listen failure.
 * stdio: stdin ignore, stdout/stderr piped (caller may attach listeners).
 * Does NOT auto-start on app boot — caller must opt in.
 * On success, registers the module-level active handle for quit cleanup.
 * Peer connect (async) stores Socket on the active handle for Cancel.
 */
export async function spawnVoiceHost(opts: SpawnVoiceHostOpts): Promise<VoiceHostSpawnResult> {
  if (!isVoiceHostEnabled(opts)) {
    return {
      ok: false,
      code: 'disabled',
      message: `voice host spawn disabled (set ${PQ_VOICE_HOST_ENV}=1 or pass enabled:true)`
    }
  }

  const argsBuilt = buildVoiceHostArgs({
    sessionId: opts.sessionId,
    tcpAddr: opts.tcpAddr,
    preferPipe: opts.preferPipe
  })
  if (!argsBuilt.ok) {
    return { ok: false, code: 'bad-session', message: argsBuilt.message }
  }

  const { exe, candidates } = resolveVoiceExe(opts.appDirs ?? defaultVoiceAppDirs())
  if (!exe) {
    return {
      ok: false,
      code: 'missing-exe',
      message: `${VOICE_EXE_NAME} not found among candidate paths (no download attempted)`,
      candidates
    }
  }

  // Sanitize session for pipe path (args already validated when preferPipe).
  let listenSession = opts.sessionId
  if (argsBuilt.transport === 'ipc-pipe') {
    const s = sanitizePipeSessionId(opts.sessionId)
    if (!s.ok) return { ok: false, code: 'bad-session', message: s.message }
    listenSession = s.id
  }

  let bound: { server: Server; pipePath?: string; listenAddr?: string }
  try {
    bound = await listenVoiceIpc({
      transport: argsBuilt.transport,
      sessionId: listenSession,
      tcpAddr: opts.tcpAddr
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      code: 'listen-failed',
      message: msg,
      candidates
    }
  }

  const handle: ActiveVoiceHost = {
    child: null as unknown as ChildProcess,
    sessionId: opts.sessionId,
    transport: argsBuilt.transport,
    exe,
    server: bound.server,
    socket: null,
    pipePath: bound.pipePath,
    listenAddr: bound.listenAddr,
    lastStatus: null,
    lastTranscripts: []
  }

  // Keep first peer only; extra connects are dropped.
  bound.server.on('connection', (sock: Socket) => {
    if (handle.socket && !handle.socket.destroyed) {
      try {
        sock.destroy()
      } catch {
        /* ignore */
      }
      return
    }
    handle.socket = sock
    attachVoiceHostSocketReader(handle, sock)
  })

  try {
    const child = spawn(exe, argsBuilt.args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
      // Intentionally omit --allow-download
    })
    handle.child = child
    registerActive(handle)
    return {
      ok: true,
      child,
      exe,
      args: argsBuilt.args,
      transport: argsBuilt.transport,
      sessionId: opts.sessionId,
      pipePath: bound.pipePath,
      listenAddr: bound.listenAddr
    }
  } catch (e) {
    destroyIpc(handle)
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      code: 'spawn-failed',
      message: msg,
      candidates
    }
  }
}

/**
 * Best-effort stop helper for callers that hold a ChildProcess.
 * Clears the module active handle when it matches this child.
 */
export function stopVoiceHost(child: ChildProcess): void {
  if (activeVoiceHost?.child === child) {
    destroyIpc(activeVoiceHost)
    activeVoiceHost = null
  } else {
    clearActiveIfMatch(child)
  }
  try {
    if (!child.killed) child.kill()
  } catch {
    /* ignore */
  }
}