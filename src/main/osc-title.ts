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