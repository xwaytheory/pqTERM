import { execFile } from 'child_process'
import { promisify } from 'util'
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { EngineId, ProviderInfo, Workspace } from '../shared/types'
import { resolveLaunch } from './resolve-launch'

const execFileP = promisify(execFile)

export interface SessionRef {
  handle: string
  title: string
  updatedAt: number
}

/** CLI flags that make an engine resume a previous conversation instead of starting fresh. */
export function resumeFlag(engine: EngineId, handle: string): string[] | null {
  switch (engine) {
    case 'opencode':
      return ['--session', handle]
    case 'omp':
      return ['--resume', handle]
    case 'hermes':
      return ['--resume', handle]
    case 'codex':
      return ['resume', handle]
    case 'claude':
      return ['--resume', handle]
    case 'qwen':
      return ['--resume', handle]
    default:
      return null
  }
}

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

async function opencodeSessions(cwd: string, target: string): Promise<SessionRef[]> {
  const { spawnFile, args } = resolveLaunch(
    'opencode',
    target,
    ['db', 'select id, directory, title, time_updated from session', '--format', 'json']
  )
  const { stdout } = await execFileP(spawnFile, args, {
    timeout: 20000,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' }
  })
  const rows = JSON.parse(stdout) as Array<{
    id?: string
    directory?: string
    title?: string
    time_updated?: number
  }>
  return rows
    .filter((r) => r.id && typeof r.directory === 'string' && norm(r.directory) === norm(cwd))
    .map((r) => ({
      handle: r.id as string,
      title: r.title ?? '',
      updatedAt: r.time_updated ?? 0
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function ompRoot(): string {
  return join(homedir(), '.omp', 'agent', 'sessions')
}

async function ompSessions(cwd: string): Promise<SessionRef[]> {
  const root = ompRoot()
  if (!existsSync(root)) return []
  const out: SessionRef[] = []
  const seen = new Set<string>()
  for (const proj of readdirSync(root)) {
    const dir = join(root, proj)
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue
      const full = join(dir, f)
      try {
        const stat = statSync(full)
        const id = ompIdFromFile(full)
        if (!id || seen.has(id)) continue
        const head = readSessionLine(full)
        let parsed: { type?: string; id?: string; cwd?: string }
        try {
          parsed = JSON.parse(head) as { type?: string; id?: string; cwd?: string }
        } catch {
          continue
        }
        if (parsed.type !== 'session' || !parsed.cwd || norm(parsed.cwd) !== norm(cwd)) continue
        seen.add(id)
        out.push({ handle: id, title: f, updatedAt: stat.mtimeMs })
      } catch {
        /* skip unreadable */
      }
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

function ompIdFromFile(name: string): string | null {
  const m = /_(.+)$/.exec(name.replace(/\.jsonl$/, ''))
  return m ? m[1] : null
}

/** read just the "session" meta line from an omp jsonl (line 2) */
function readSessionLine(file: string): string {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(64 * 1024)
    const n = readSync(fd, buf, 0, buf.length, 0)
    const text = buf.toString('utf8', 0, n)
    const first = text.indexOf('\n')
    if (first === -1) return text
    const start = first + 1
    const second = text.indexOf('\n', start)
    return second === -1 ? text.slice(start) : text.slice(start, second)
  } finally {
    closeSync(fd)
  }
}

async function listSessions(engine: EngineId, cwd: string, target: string): Promise<SessionRef[]> {
  try {
    if (engine === 'opencode') return await opencodeSessions(cwd, target)
    if (engine === 'omp') return await ompSessions(cwd)
    if (engine === 'hermes') return await hermesSessions(cwd, target)
    if (engine === 'codex') return await codexSessions(cwd, target)
    if (engine === 'claude') return await claudeSessions(cwd, target)
    if (engine === 'qwen') return await qwenSessions(cwd, target)
  } catch {
    /* offline storage should never break startup */
  }
  return []
}

interface Slot {
  ref: SessionRef
  claimed: boolean
}

const cache = new Map<string, Slot[]>()

function keyOf(workspaceId: string, engine: EngineId): string {
  return `${workspaceId}\u0000${engine}`
}

/** Scan engine session storage once per (workspace, engine) at boot. */
export async function primeResume(workspaces: Workspace[], providers: ProviderInfo[]): Promise<void> {
  cache.clear()
  const jobs: Array<Promise<void>> = []
  for (const ws of workspaces) {
    const engines = new Set<string>()
    for (const p of ws.panes) if (p.engine) engines.add(p.engine)
    for (const engine of engines) {
      const provider = providers.find((x) => x.id === engine) ?? null
      const target = provider?.resolvedPath || engine
      jobs.push(
        listSessions(engine as EngineId, ws.cwd, target).then((list) => {
          cache.set(keyOf(ws.id, engine as EngineId), list.map((ref) => ({ ref, claimed: false })))
        })
      )
    }
  }
  await Promise.all(jobs)
}

/**
 * Pick which stored agent conversation a pane should resume.
 * A handle persisted on the pane wins (stable across restarts); otherwise the
 * newest still-unclaimed session for that workspace/engine is assigned.
 */
export function pickResume(
  workspaceId: string,
  engine: EngineId,
  sessionHandle?: string | null
): SessionRef | null {
  const slots = cache.get(keyOf(workspaceId, engine))
  if (!slots) return null
  if (sessionHandle) {
    const prev = slots.find((s) => s.ref.handle === sessionHandle)
    if (prev && !prev.claimed) {
      prev.claimed = true
      return prev.ref
    }
  }
  for (const s of slots) {
    if (s.claimed) continue
    s.claimed = true
    return s.ref
  }
  return null
}