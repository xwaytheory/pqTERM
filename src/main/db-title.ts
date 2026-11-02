function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export interface DbSession {
  directory?: string
  title?: string
  time_updated?: number
  /** `opencode session list --format json` names the same field `updated`. */
  updated?: number
}

/**
 * True when a session's recorded directory belongs to the pane's project.
 * opencode records the project root, so a pane opened in a worktree
 * (`…/pqTERM/instances/dev`) still matches `…/pqTERM`.
 */
export function sameProject(dir: string | undefined, cwd: string): boolean {
  if (!dir) return true
  const d = norm(dir)
  const c = norm(cwd)
  return c === d || c.startsWith(`${d}/`)
}

/** Pick the most-recently-updated non-archived session for a given cwd. */
export function pickActiveTitle(rows: DbSession[], cwd: string): string | null {
  const got = rows
    .filter((r) => typeof r.title === 'string' && r.title.trim() && sameProject(r.directory, cwd))
    .sort((a, b) => (b.updated ?? b.time_updated ?? 0) - (a.updated ?? a.time_updated ?? 0))
  return got[0]?.title?.trim() ?? null
}
