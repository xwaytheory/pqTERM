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

/**
 * Spawn pq-voice.exe. Never throws for missing binary / disabled.
 * stdio: stdin ignore, stdout/stderr piped (caller may attach listeners).
 * Does NOT auto-start on app boot — caller must opt in.
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

/** Best-effort stop helper for callers that hold a ChildProcess. */
export function stopVoiceHost(child: ChildProcess): void {
  try {
    if (!child.killed) child.kill()
  } catch {
    /* ignore */
  }
}