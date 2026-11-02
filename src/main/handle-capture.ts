import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/** One `~/.codebuddy/sessions/<pid>.json` entry. */
export interface CodebuddyEntry {
  pid?: number
  sessionId?: string
  cwd?: string
  startedAt?: number
}

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Prefer the entry published under this exact pid; fall back to the newest entry
 * for the same cwd that started after the pane did. The pid path is the only one
 * that stays correct when two panes share a workspace directory.
 */
export function pickCodebuddySession(
  entries: CodebuddyEntry[],
  pid: number,
  cwd: string,
  since: number
): string | null {
  const own = entries.find((e) => e.pid === pid && typeof e.sessionId === 'string' && e.sessionId)
  if (own?.sessionId) return own.sessionId
  const byCwd = entries
    .filter(
      (e) =>
        typeof e.sessionId === 'string' &&
        e.sessionId &&
        typeof e.cwd === 'string' &&
        norm(e.cwd) === norm(cwd) &&
        typeof e.startedAt === 'number' &&
        e.startedAt >= since
    )
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  return byCwd[0]?.sessionId ?? null
}

/** First line only — trace files grow to megabytes and only the header matters. */
function firstLine(file: string): string {
  let fd: number | undefined
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(8192)
    const n = readSync(fd, buf, 0, buf.length, 0)
    return buf.subarray(0, n).toString('utf8').split('\n')[0] ?? ''
  } catch {
    return ''
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * The registry publishes a CLI handle (`interactive-<pid>`), not the uuid that names the
 * transcript. The pid-keyed trace header carries the real one, so it wins when present.
 */
function traceHandle(pid: number): string | null {
  const dir = join(homedir(), '.codebuddy', 'traces', String(pid))
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return null
  }
  let fallback: string | null = null
  for (const file of files) {
    let head: {
      trace?: { agent?: { kind?: string; sessionId?: string } }
    }
    try {
      head = JSON.parse(firstLine(join(dir, file)))
    } catch {
      continue
    }
    const agent = head.trace?.agent
    if (typeof agent?.sessionId !== 'string' || !agent.sessionId) continue
    // subagent traces share the pid but not the conversation — never hand those over
    if (agent.kind === 'main') return agent.sessionId
    fallback ??= agent.sessionId
  }
  return fallback
}

function registryDir(): string {
  return join(homedir(), '.codebuddy', 'sessions')
}

/** A stored handle is only useful if a transcript is actually named after it. */
function transcriptExists(handle: string): boolean {
  const root = join(homedir(), '.codebuddy', 'projects')
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .some((d) => existsSync(join(root, d.name, `${handle}.jsonl`)))
  } catch {
    return false
  }
}

function readEntry(file: string): CodebuddyEntry | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return raw && typeof raw === 'object' ? (raw as CodebuddyEntry) : null
  } catch {
    return null
  }
}

/** Exact pid-keyed lookup — no cwd guessing. Used when a pane has no handle yet. */
export function codebuddyTraceHandle(pid: number): string | null {
  return traceHandle(pid)
}

/** Read-only. Returns null when CodeBuddy has not published a usable session yet. */
export function captureCodebuddyHandle(pid: number, cwd: string, since: number): string | null {
  const traced = traceHandle(pid)
  if (traced) return traced
  const dir = registryDir()
  const own = readEntry(join(dir, `${pid}.json`))
  // the registry also publishes CLI handles (interactive-<pid>) that name no transcript
  if (own?.sessionId && transcriptExists(own.sessionId))
    return pickCodebuddySession([own], pid, cwd, since)
  try {
    const entries = readdirSync(dir)
      .filter((f) => /^\d+\.json$/.test(f))
      .map((f) => readEntry(join(dir, f)))
      .filter((e): e is CodebuddyEntry => Boolean(e))
    const usable = entries.filter((e) => e.sessionId && transcriptExists(e.sessionId))
    return pickCodebuddySession(usable, pid, cwd, since)
  } catch {
    return null
  }
}
