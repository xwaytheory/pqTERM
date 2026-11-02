import { execFile } from 'child_process'
import { promisify } from 'util'
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { EngineId, ProviderInfo, Workspace } from '../shared/types'
import { sameProject } from './db-title'
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
    case 'codebuddy':
      return ['--resume', handle]
    default:
      return null
  }
}

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** One row of `opencode session list --format json` (verified on opencode 2.2.5). */
export interface OpenCodeRow {
  id?: string
  title?: string
  /** epoch ms */
  updated?: number
  /** project root the session belongs to — not necessarily the pane cwd */
  directory?: string
}

/**
 * The CLI is the only supported reader of opencode's store: it owns a sqlite file
 * with two parallel schemas (`session` vs `session_v2`), so we never open it directly.
 * `session list` is scoped by the process cwd, hence `cwd` is passed to execFile.
 */
export async function opencodeSessionRows(cwd: string, target: string): Promise<OpenCodeRow[]> {
  const { spawnFile, args } = resolveLaunch('opencode', target, ['session', 'list', '--format', 'json'])
  const { stdout } = await execFileP(spawnFile, args, {
    cwd,
    timeout: 20000,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' }
  })
  const rows: unknown = JSON.parse(stdout)
  return Array.isArray(rows) ? (rows as OpenCodeRow[]) : []
}

/** Pure: rows -> resumable sessions for this project, newest first. */
export function opencodeRefs(rows: OpenCodeRow[], cwd: string): SessionRef[] {
  return rows
    .filter((r) => typeof r.id === 'string' && r.id && sameProject(r.directory, cwd))
    .map((r) => ({ handle: r.id as string, title: r.title ?? '', updatedAt: r.updated ?? 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

async function opencodeSessions(cwd: string, target: string): Promise<SessionRef[]> {
  return opencodeRefs(await opencodeSessionRows(cwd, target), cwd)
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

/**
 * `null` means "this store could not be read" — distinct from "read and empty".
 * That difference decides whether a pane's persisted handle may be dropped.
 */
async function listSessions(engine: EngineId, cwd: string, target: string): Promise<SessionRef[] | null> {
  try {
    if (engine === 'opencode') return await opencodeSessions(cwd, target)
    if (engine === 'omp') return await ompSessions(cwd)
  } catch {
    /* offline storage should never break startup */
  }
  return null
}

interface Slot {
  ref: SessionRef
  paneId: string | null
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
          // unreadable or unsupported store: leave the key absent so handles survive
          if (!list) return
          cache.set(
            keyOf(ws.id, engine as EngineId),
            list.map((ref) => ({
              ref,
              paneId:
                ws.panes.find((p) => p.engine === engine && p.sessionHandle === ref.handle)?.id ?? null
            }))
          )
        })
      )
    }
  }
  await Promise.all(jobs)
}

/**
 * Pick which stored agent conversation a pane should resume.
 * A handle persisted on the pane wins (stable across restarts); otherwise the
 * newest still-unclaimed session for that workspace/engine is assigned to the pane.
 */
export function pickResume(
  workspaceId: string,
  engine: EngineId,
  paneId: string,
  sessionHandle?: string | null
): SessionRef | null {
  const slots = cache.get(keyOf(workspaceId, engine))
  if (!slots) {
    // CodeBuddy has no store listing, so the handle captured at spawn is the only pointer
    return sessionHandle && engine === 'codebuddy'
      ? { handle: sessionHandle, title: '', updatedAt: 0 }
      : null
  }
  const owned = slots.find((s) => s.paneId === paneId)
  if (owned) return owned.ref
  if (sessionHandle) {
    const prev = slots.find((s) => s.ref.handle === sessionHandle)
    if (prev && prev.paneId === null) {
      prev.paneId = paneId
      return prev.ref
    }
  }
  for (const s of slots) {
    if (s.paneId !== null) continue
    s.paneId = paneId
    return s.ref
  }
  return null
}

/**
 * Drop a pane's handle only when this engine's store was actually read and no
 * longer holds it. A store that could not be read (CLI missing, DB locked,
 * engine without a listing) must not erase the only pointer to a conversation.
 */
export function shouldClearHandle(
  workspaceId: string,
  engine: EngineId,
  sessionHandle?: string | null
): boolean {
  return !!sessionHandle && cache.has(keyOf(workspaceId, engine))
}