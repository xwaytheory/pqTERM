/**
 * Desktop-notification escape sequences that agent CLIs emit to ask the
 * terminal to notify the user:
 *   OSC 9    — iTerm2 "post notification":  ESC ] 9 ; <body> BEL/ST
 *   OSC 99   — kitty notification:           ESC ] 99 ; <meta>[;<body>] BEL/ST
 *   OSC 777  — rxvt-unicode style:           ESC ] 777 ; notify ; <title> ; <body> BEL/ST
 * ConPTY passes all of them through as plain output, so scanning the same stream
 * we already read for BELs gives every CLI a notification channel — no per-CLI
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
  /\x1b\]9;([^\x07\x1b]*)(?:\x07|\x1b\\)|\x1b\]99;([^\x07\x1b]*)(?:\x07|\x1b\\)|\x1b\]777;notify;([^\x07\x1b]*?);([^\x07\x1b]*)(?:\x07|\x1b\\)/g

/**
 * Warp's CLI-agent protocol rides on OSC 777: the "title" is the sentinel
 * `warp://cli-agent` and the body is a JSON event envelope. omp and hermes emit
 * exactly the events a user wants a toast for (question, permission, turn end),
 * so decode them instead of showing raw JSON.
 */
const WARP_SENTINEL = 'warp://cli-agent'

function warpNotice(body: string): OscNotice | null {
  const raw = body.trim()
  if (!raw.startsWith('{')) return null
  let event: Record<string, unknown>
  try {
    event = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  const agent = typeof event.agent === 'string' && event.agent ? event.agent : 'CLI'
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const name = text(event.event)
  let body2: string
  if (name === 'question_asked') body2 = text(event.summary) || 'Czeka na Twoją odpowiedź'
  else if (name === 'permission_request') {
    body2 = text(event.summary) || `Prośba o zgodę na ${text(event.tool_name) || 'operację'}`
  } else if (name === 'stop_failure') {
    body2 = `Przerwane: ${text(event.response) || text(event.error_type) || 'błąd'}`
  } else if (name === 'stop') {
    body2 = text(event.response) || 'Odpowiedź gotowa'
  } else return null
  return { title: agent, body: body2.slice(0, 240) }
}

/** kitty: `\x1b]99;key=value:key=value;body` — metadata first, message last. */
function kittyNotice(raw: string): OscNotice {
  const parts = raw.split(';')
  const body = parts.length > 1 ? parts.slice(1).join(';') : raw
  const meta = parts[0] ?? ''
  const title = /title=([^:;]+)/.exec(meta)?.[1] ?? ''
  return { title, body: body || raw }
}

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
    } else if (m[0].startsWith('\x1b]99;')) {
      notices.push(kittyNotice(m[2] ?? ''))
    } else {
      const title = m[3] ?? ''
      const body = m[4] ?? ''
      notices.push((title === WARP_SENTINEL && warpNotice(body)) || { title, body })
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
