/** First letter/digit for monogram chips (no vendor logos). */
export function letterFromName(name: string): string {
  const t = name.trim()
  for (const ch of t) {
    if (/[A-Za-z0-9]/.test(ch)) return ch.toUpperCase()
  }
  return '?'
}

/**
 * Two-letter (or explicit) monogram for engines whose single letter collides.
 * Prefer EngineSpec.mark when set; else first letter of name.
 */
export function markForEngine(id: string, name: string, explicit?: string | null): string {
  if (explicit && explicit.trim()) return explicit.trim().slice(0, 2)
  const collisions: Record<string, string> = {
    claude: 'Cl',
    codex: 'Cx',
    crush: 'Cr',
    copilot: 'Co',
    grok: 'Gr',
    gemini: 'Ge',
    omp: 'Om',
    opencode: 'Oc'
  }
  if (collisions[id]) return collisions[id]
  return letterFromName(name)
}
