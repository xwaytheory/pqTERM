/** Shell flavors for path quoting when pasting into a PTY. */
export type PathShell = 'cmd' | 'pwsh' | 'posix'

/**
 * Optional host/engine hints for DnD quoting.
 * PaneState has no hostType yet — when WSL/bash panes exist, pass hostType: 'wsl'|'posix'.
 */
export type PathShellHostHint = {
  engine?: string | null
  /** Future pane PTY host; today almost always ConPTY on Windows. */
  hostType?: 'conpty' | 'wsl' | 'posix' | 'cmd' | 'pwsh' | null
}

/**
 * Map pane host/engine → PathShell for formatDroppedPaths.
 * - hostType wsl/posix → posix quoting
 * - hostType pwsh / engine `shell` (powershell.exe) → pwsh
 * - otherwise Windows ConPTY agent CLIs → cmd (same "" escapes as pwsh today)
 */
export function pathShellForPane(hint: PathShellHostHint): PathShell {
  const host = hint.hostType
  if (host === 'wsl' || host === 'posix') return 'posix'
  if (host === 'pwsh') return 'pwsh'
  if (host === 'cmd' || host === 'conpty') return 'cmd'
  if (hint.engine === 'shell') return 'pwsh'
  return 'cmd'
}

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
