// Pure helpers for the raw ConPTY byte stream pqTERM keeps per pane.
// Kept out of main/renderer so `node --test` can cover them without Electron.

export const TERM_BUF_MAX = 512 * 1024

const ESC = 0x1b

/** Backwards window for "does an escape sequence span the cut?" — CSI is short. */
const BACK_SCAN = 512
/** Forwards window while looking for an OSC/DCS terminator. */
const SEQ_SCAN = 4096

function lastEscapeBefore(data: string, index: number): number {
  const from = Math.max(0, index - BACK_SCAN)
  for (let i = index - 1; i >= from; i--) {
    if (data.charCodeAt(i) === ESC) return i
  }
  return -1
}

/**
 * Index of the final byte of the escape sequence starting at `start`, or -1 when
 * it is unterminated inside the scanned window.
 * CSI ends on the first byte in 0x40-0x7e; string-like sequences end on BEL/ST.
 */
function sequenceEnd(data: string, start: number): number {
  const kind = data.charCodeAt(start + 1)
  if (Number.isNaN(kind)) return start
  if (kind === 0x5b) {
    // CSI: parameters/intermediates 0x20-0x3f, final byte 0x40-0x7e
    const to = Math.min(data.length, start + SEQ_SCAN)
    for (let i = start + 2; i < to; i++) {
      const c = data.charCodeAt(i)
      if (c >= 0x40 && c <= 0x7e) return i
    }
    return -1
  }
  if (kind === 0x5d || kind === 0x50 || kind === 0x58 || kind === 0x5e || kind === 0x5f) {
    // OSC / DCS / SOS / PM / APC: terminated by BEL or ST (ESC \)
    const to = Math.min(data.length, start + SEQ_SCAN)
    for (let i = start + 2; i < to; i++) {
      const c = data.charCodeAt(i)
      if (c === 0x07) return i
      if (c === ESC && data.charCodeAt(i + 1) === 0x5c) return i + 1
    }
    return -1
  }
  // two-byte escape (ESC 7, ESC =, ESC ( B …): the final character ends it
  let i = start + 1
  while (i < data.length) {
    const c = data.charCodeAt(i)
    if (c >= 0x30 && c <= 0x7e) return i
    i++
  }
  return -1
}

/**
 * `prev + data` capped at `max` characters, trimmed at the head.
 * The cut is moved past any escape sequence it lands inside: feeding the
 * terminal half a sequence makes it swallow the bytes that follow, which is how
 * a trimmed replay ends up smearing fragments of old frames onto the screen.
 */
export function appendTail(prev: string, data: string, max = TERM_BUF_MAX): string {
  const joined = prev + data
  if (joined.length <= max) return joined
  let cut = joined.length - max
  // never split a surrogate pair
  if (cut > 0 && /[\ud800-\udbff]/.test(joined[cut - 1] ?? '')) cut -= 1
  const escape = lastEscapeBefore(joined, cut)
  if (escape >= 0) {
    const end = sequenceEnd(joined, escape)
    if (end >= cut && end >= 0) cut = end + 1
  }
  return joined.slice(cut)
}
