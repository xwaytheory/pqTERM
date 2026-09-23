/**
 * Desktop-notification escape sequences that agent CLIs emit to ask the
 * terminal to notify the user:
 *   OSC 9    — iTerm2 "post notification":  ESC ] 9 ; <body> BEL/ST
 *   OSC 777  — rxvt-unicode style:           ESC ] 777 ; notify ; <title> ; <body> BEL/ST
 * ConPTY passes both through as plain output, so scanning the same stream we
 * already read for BELs gives every CLI a notification channel — no per-CLI
 * integrations needed.
 */

/** Notification extracted from a completed sequence. */
export interface OscNotice {
  title: string
  body: string
}

/** Longest possible prefix of an unterminated sequence we keep between chunks. */
const MAX_TAIL = 2048

const PATTERN =
  /\x1b\]9;([^\x07\x1b]*)(?:\x07|\x1b\\)|\x1b\]777;notify;([^\x07\x1b]*?);([^\x07\x1b]*)(?:\x07|\x1b\\)/g

/**
 * Scan accumulated output for complete notification sequences. Returns every
 * notice found and the tail to keep for the next chunk (an unterminated
 * sequence prefix, capped at MAX_TAIL — pathological garbage is dropped).
 */
export function scanOscNotices(acc: string): [notices: OscNotice[], keep: string] {
  const notices: OscNotice[] = []
  let cursor = 0
  let m: RegExpExecArray | null
  PATTERN.lastIndex = 0
  while ((m = PATTERN.exec(acc))) {
    if (m[0].startsWith('\x1b]9;')) {
      notices.push({ title: '', body: m[1] ?? '' })
    } else {
      notices.push({ title: m[2] ?? '', body: m[3] ?? '' })
    }
    cursor = m.index + m[0].length
  }
  const rest = acc.slice(cursor)
  let keep = ''
  if (rest) {
    const idx = rest.lastIndexOf('\x1b]')
    if (idx !== -1 && !/[\x07]|\x1b\\/.test(rest.slice(idx + 2))) {
      keep = rest.slice(idx)
      if (keep.length > MAX_TAIL) keep = ''
    }
  }
  return [notices, keep]
}

/** Clean control characters out of CLI-provided text before it hits a toast. */
export function cleanNoticeText(s: string): string {
  return s.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim()
}
