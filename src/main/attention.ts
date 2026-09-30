/**
 * "Is this pane asking me something?" — a pure classifier over the tail of a
 * pane's raw output, used when a CLI goes quiet.
 *
 * Most agent CLIs (claude, codex, opencode, gemini, qwen, copilot, cline,
 * crush, cursor, kimi, dsh, zcode, freebuff, aider, grok, ...) ship their
 * notification channel switched OFF by default, and half of them have none at
 * all. The one signal pqTERM always has is the screen itself: an approval or
 * question prompt freezes the TUI with a yes/no affordance, and a finished turn
 * leaves the input box empty.
 *
 * Deliberately narrow: a question needs a real affordance (`[y/n]`, `1. Yes`,
 * "Do you want ...?", "Needs your permission"), and the empty-input-box case is
 * only reported for agent panes, never for a raw shell. Silence alone is never
 * a signal — a long tool call is silent too.
 */

/** Strip CSI/OSC/escape noise so the tail reads like the visible screen. */
export function stripControls(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, ' ')
    .replace(/\x1b[P^_X][^\x1b]*(?:\x1b\\|\x07)/g, ' ')
    .replace(/\x1b[\[\]()#;?][0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
}

const BOX = /[\s\u2500-\u257f\u2580-\u259f▀-▟|]/g

/** Last few non-empty, control-free lines of the tail — what the user can see. */
export function visibleLines(raw: string, count = 4): string[] {
  return stripControls(raw)
    .split(/\r?\n/)
    .map((l) => l.replace(BOX, ' ').trim())
    .filter(Boolean)
    .slice(-count)
}

/** A yes/no affordance in the last lines: the CLI is blocked on the user. */
const QUESTION =
  /\[\s*Y\s*\/\s*N\s*\]|\(\s*Y\s*\/\s*N\s*\)|\d\s*\.\s*(Yes|No|Tak|Nie)\b|(?:^|\s)(?:❯|›|>)\s*\d\s*\.\s*(?:Yes|No|Tak|Nie)\b|do you want|would you like|are you sure|proceed\b[^.\n]{0,40}\?|\ballow\b[^.\n]{0,40}\?|\bapprove\b[^.\n]{0,40}\?|needs? your (?:permission|approval|input|answer|response)|wants to run|czy chcesz|czy mam (?:kontynuować|uruchomić)|wybierz (?:opcję|jedną)|potrzebuje twojej zgody|zapytanie/i

/** The pane sits at an empty input box: the turn is over, the agent is idle. */
const IDLE_BOX = /^(?:[>$❯›»#»]?|prompt>?|type (?:your )?(?:message|prompt)|\/[a-z]+)?$/

export function isQuestion(lines: string[]): boolean {
  return lines.some((l) => QUESTION.test(l))
}

export function isIdleInputBox(lines: string[]): boolean {
  const last = lines[lines.length - 1]
  if (last === undefined) return false
  return IDLE_BOX.test(last) && lines.length <= 2
}
