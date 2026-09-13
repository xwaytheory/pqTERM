/**
 * Electron main → pq-voice.exe spawn sketch (opt-in).
 *
 * Mirrors `pq_core::ipc::VoiceHostSpawnPlan` / `voice_exe_candidates`.
 * Overnight default: OFF. Production path unchanged unless:
 *   - process.env.PQ_VOICE_HOST === '1', OR
 *   - spawnVoiceHost({ enabled: true, ... }) is called explicitly.
 *
 * Do NOT import this into app.whenReady / UI click paths without the gate.
 * Never passes --allow-download (missing GGML = error, not a 3 GB fetch).
 *
 * Quit lifecycle: successful spawn registers a module-level active handle;
 * `shutdownVoiceHost()` (wired from `app.on('before-quit')`) is a no-op when
 * nothing was ever spawned. Cancel-over-IPC is best-effort TODO (stdin is
 * ignore — Cancel cannot go via stdin).
 *
 * See docs/VOICE-HOST-BRIDGE.md
 */
import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'

/** Mirrors pq_core::ipc::VOICE_EXE_NAME */
export const VOICE_EXE_NAME = 'pq-voice.exe'

/** Mirrors pq_core::ipc::DEFAULT_TCP_ADDR */
export const DEFAULT_TCP_ADDR = '127.0.0.1:4791'

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
}

export type VoiceHostSpawnErr = {
  ok: false
  code: 'disabled' | 'missing-exe' | 'bad-session' | 'spawn-failed'
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
export type ActiveVoiceHost = {
  child: ChildProcess
  sessionId: string
  transport: VoiceTransport
  exe: string
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

function clearActiveIfMatch(child: ChildProcess): void {
  if (activeVoiceHost?.child === child) activeVoiceHost = null
}

function registerActive(handle: ActiveVoiceHost): void {
  // Replace prior active without pretending Cancel was sent — caller owns lifecycle.
  if (activeVoiceHost && activeVoiceHost.child !== handle.child) {
    try {
      if (!activeVoiceHost.child.killed) activeVoiceHost.child.kill()
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
  activeVoiceHost = handle
}

/**
 * Encode a Cancel JSON line matching Rust `IpcMessage::Cancel` / `encode_line`
 * (`{"type":"cancel","session_id":"...","reason":...}`).
 * Exported for docs / future IPC client — not sent on quit this wave.
 */
export function encodeCancelLine(sessionId: string, reason?: string): string {
  const body: { type: 'cancel'; session_id: string; reason?: string } = {
    type: 'cancel',
    session_id: sessionId
  }
  if (reason !== undefined) body.reason = reason
  return JSON.stringify(body)
}

/**
 * Best-effort IPC Cancel — **not implemented overnight**.
 *
 * Honesty:
 * - Spawn uses `stdio: ['ignore', 'pipe', 'pipe']` so Cancel **cannot** go via stdin.
 * - Real Cancel needs a duplex to the child's pipe/TCP using the same framing as Rust
 *   (`encode_line`). Host typically listens first (`pq-work --ipc-pipe`); this sketch
 *   does not yet hold an open client/server socket to write a Cancel line.
 * - Opening `\\.\pipe\pq-voice-{session}` / TCP as a brief client on quit is deferred
 *   (fragile without an established session duplex). Callers must not pretend Cancel
 *   was delivered when this returns false.
 *
 * @returns always `false` this wave (Cancel not sent).
 */
export function trySendCancelToActiveVoiceHost(_reason?: string): boolean {
  // TODO(overnight): if we later keep a net.Socket / NamedPipe duplex on the active
  // handle, write encodeCancelLine + '\n' here. Until then: do not claim success.
  return false
}

/**
 * Stop the tracked voice-host child if any. Safe no-op when never spawned.
 *
 * Order: attempt Cancel (currently always skipped — see trySendCancelToActiveVoiceHost),
 * then orderly `child.kill()`, then on win32 `kill('SIGKILL')` after
 * {@link VOICE_HOST_KILL_GRACE_MS} if still alive. Never kills unrelated PIDs.
 */
export function shutdownVoiceHost(): void {
  const active = activeVoiceHost
  if (!active) return

  // Clear first so re-entrant before-quit / exit handlers are no-ops.
  activeVoiceHost = null

  // Cancel over IPC: best-effort TODO — not sent (stdin ignore; no duplex held).
  void trySendCancelToActiveVoiceHost('app-quit')

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

/**
 * Spawn pq-voice.exe. Never throws for missing binary / disabled.
 * stdio: stdin ignore, stdout/stderr piped (caller may attach listeners).
 * Does NOT auto-start on app boot — caller must opt in.
 * On success, registers the module-level active handle for quit cleanup.
 */
export function spawnVoiceHost(opts: SpawnVoiceHostOpts): VoiceHostSpawnResult {
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

  try {
    const child = spawn(exe, argsBuilt.args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
      // Intentionally omit --allow-download
    })
    registerActive({
      child,
      sessionId: opts.sessionId,
      transport: argsBuilt.transport,
      exe
    })
    return {
      ok: true,
      child,
      exe,
      args: argsBuilt.args,
      transport: argsBuilt.transport,
      sessionId: opts.sessionId
    }
  } catch (e) {
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
  clearActiveIfMatch(child)
  try {
    if (!child.killed) child.kill()
  } catch {
    /* ignore */
  }
}