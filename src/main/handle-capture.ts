import { readFileSync, readdirSync } from 'fs'
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

function registryDir(): string {
  return join(homedir(), '.codebuddy', 'sessions')
}

function readEntry(file: string): CodebuddyEntry | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return raw && typeof raw === 'object' ? (raw as CodebuddyEntry) : null
  } catch {
    return null
  }
}

/** Read-only. Returns null when CodeBuddy has not published its session yet. */
export function captureCodebuddyHandle(pid: number, cwd: string, since: number): string | null {
  const dir = registryDir()
  const own = readEntry(join(dir, `${pid}.json`))
  if (own?.sessionId) return pickCodebuddySession([own], pid, cwd, since)
  try {
    const entries = readdirSync(dir)
      .filter((f) => /^\d+\.json$/.test(f))
      .map((f) => readEntry(join(dir, f)))
      .filter((e): e is CodebuddyEntry => Boolean(e))
    return pickCodebuddySession(entries, pid, cwd, since)
  } catch {
    return null
  }
}
