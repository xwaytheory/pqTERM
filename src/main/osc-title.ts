/**
 * Extract the window/icon title that CLIs (opencode/omp/…) set via OSC:
 * `ESC ] Pc ; title ST` where Pc ∈ {0,1,2} and ST = BEL (\x07) or `ESC \`.
 * The stream arrives in arbitrary chunks, so the parser keeps a partial tail.
 */

/** Scan accumulated output for the last complete OSC title. Returns the title and the tail to keep. */
export function scanOscTitle(acc: string): [title: string, keep: string] {
  const re = /\x1b\](?:0|1|2);([^\x07\x1b]*)(?:\x07|\x1b\\)/g
  let title = ''
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(acc))) {
    title = m[1] ?? ''
    cursor = m.index + m[0].length
  }
  const rest = acc.slice(cursor)
  let keep = ''
  if (rest) {
    const idx = rest.lastIndexOf('\x1b]')
    if (idx !== -1 && !/[\x07]|\x1b\\/.test(rest.slice(idx + 2))) {
      keep = rest.slice(idx)
      if (keep.length > 1024) keep = '' // pathological unterminated OSC — forget it
    }
  }
  return [title, keep]
}

/** Strip any ANSI SGR inside the OSC payload and normalize whitespace. */
export function cleanOscTitle(raw: string): string {
  const s = raw
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > 60 ? `${s.slice(0, 59)}…` : s
}

/** The CLI's own brand identity — its OSC title often starts with a mark + separator. */
export interface CliIdentity {
  id?: string
  name?: string
  mark?: string
}

/** Brand glyphs that are not part of a session title (opencode/omp both use π). */
const BRAND_GLYPHS = ['π']

/**
 * Strip a leading CLI brand token (id/name/mark, e.g. "Omp", "omp", "π") plus a
 * separator (` > `, `: `, ` – `, ` | `) from a session title. Glyph-only tokens are
 * dropped even when followed by a plain space; word tokens need a real separator
 * so titles that legitimately start with the engine name survive.
 */
export function stripCliPrefix(raw: string, cli: CliIdentity): string {
  let t = raw.trim()
  if (!t) return t
  const tokens = [cli.id, cli.name, cli.mark, ...BRAND_GLYPHS]
    .map((x) => x?.trim())
    .filter((x): x is string => Boolean(x))
  if (!tokens.length) return t
  const alts = [...new Set(tokens)]
    .sort((a, b) => b.length - a.length)
    .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const re = new RegExp(`^(?:${alts})`, 'i')
  for (;;) {
    t = t.trim()
    if (!t) return t
    const m = t.match(re)
    if (!m || !m[0]) return t
    const after = t.slice(m[0].length).trimStart()
    if (!after) return t
    const isGlyph = /^\W+$/.test(m[0]) || m[0].includes('π')
    if (isGlyph || /^[>:|]/.test(after) || /^[–—−-]+\s/.test(after)) {
      t = after.replace(/^[>:|]/, '').replace(/^[–—−-]+\s/, '').trimStart()
      continue
    }
    return t
  }
}