function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

interface DbSession {
  directory?: string
  title?: string
  time_updated?: number
}

/** Pick the most-recently-updated non-archived session for a given cwd. */
export function pickActiveTitle(rows: DbSession[], cwd: string): string | null {
  const got = rows
    .filter((r) => typeof r.directory === 'string' && typeof r.title === 'string' && r.title.trim() && norm(r.directory) === norm(cwd))
    .sort((a, b) => (b.time_updated ?? 0) - (a.time_updated ?? 0))
  return got[0]?.title?.trim() ?? null
}
