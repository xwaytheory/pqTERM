/** Quote a filesystem path for pasting into a Windows-friendly CLI/TUI. */
export function quotePath(p: string): string {
  const s = p.trim()
  if (!s) return s
  if (/[\s"]/.test(s)) return `"${s.replace(/"/g, '\\"')}"`
  return s
}

/** Join dropped paths with a trailing space (ready to type more / Enter). */
export function formatDroppedPaths(paths: string[]): string {
  const parts = paths.map(quotePath).filter(Boolean)
  if (!parts.length) return ''
  return parts.join(' ') + ' '
}
