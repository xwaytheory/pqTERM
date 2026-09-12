/** Shell flavors for path quoting when pasting into a PTY. */
export type PathShell = 'cmd' | 'pwsh' | 'posix'

/**
 * Quote a filesystem path for pasting into a CLI/TUI.
 *
 * - `cmd` / `pwsh` (default `cmd`): Windows-style `"..."` with embedded `"` doubled as `""`
 *   (works for cmd.exe and PowerShell; do NOT use Unix `\"` escapes).
 * - `posix`: single-quote with `'\''` for embedded quotes.
 */
export function quotePath(p: string, shell: PathShell = 'cmd'): string {
  const s = p.trim()
  if (!s) return s

  if (shell === 'posix') {
    if (!/[\s'"\\$`!]/.test(s)) return s
    return `'${s.replace(/'/g, `'\\''`)}'`
  }

  // Windows cmd + pwsh: only quote when needed; escape " as ""
  if (!/[\s"&<>|^%]/.test(s)) return s
  return `"${s.replace(/"/g, '""')}"`
}

/** Join dropped paths with a trailing space (ready to type more / Enter). */
export function formatDroppedPaths(paths: string[], shell: PathShell = 'cmd'): string {
  const parts = paths.map((p) => quotePath(p, shell)).filter(Boolean)
  if (!parts.length) return ''
  return parts.join(' ') + ' '
}
