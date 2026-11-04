import type { EngineId } from '../shared/types'
import type { TranscriptEvent } from './ledger'

export interface HandoffSeedInput {
  checkpointPath: string
  sourceEngine: EngineId | null
  targetEngine: EngineId
  /** set when the source transcript could not be read in full */
  degraded?: string
  /** tail of the conversation, inline — engines without an import path still get it */
  digest?: string
}

/** Longest tail we paste into a TUI prompt: enough to continue, small enough to stay one turn. */
export const DIGEST_MAX = 1200

/**
 * Last turns as one line: an engine that cannot import a session still receives
 * the actual conversation instead of a path it may never open. Newest turns win.
 */
export function transcriptDigest(events: TranscriptEvent[], max = DIGEST_MAX): string {
  const turns = events.filter(
    (e) => (e.role === 'user' || e.role === 'assistant') && e.text.trim()
  )
  const parts: string[] = []
  let size = 0
  for (let i = turns.length - 1; i >= 0 && size < max; i--) {
    const turn = turns[i]
    const line = `${turn.role === 'user' ? 'U' : 'A'}: ${turn.text.replace(/\s+/g, ' ').trim()}`
    if (size + line.length > max && parts.length) break
    parts.unshift(line)
    size += line.length
  }
  return parts.join(' | ').slice(0, max)
}

/**
 * One line, no newlines: every one of these CLIs is a full-screen TUI, and a
 * multi-line paste submits each line as a separate turn. The checkpoint stays a
 * file the agent opens itself — that survives every engine's paste handling.
 */
export function handoffSeed(input: HandoffSeedInput): string {
  const from = input.sourceEngine ?? 'poprzednie CLI'
  const parts = [
    `Przejmujesz zadanie po ${from} w tym samym katalogu.`,
    // backticks: a Windows profile path may contain spaces, and a bare path
    // would be split by the TUI's prompt parser
    `Kontekst: \`${input.checkpointPath}\``,
    'Przeczytaj ten plik w całości, sprawdź `git status` i kontynuuj od ostatniej prośby użytkownika.',
    'Nie powtarzaj pracy, która jest już zrobiona.'
  ]
  if (input.digest) {
    parts.push(`Dotychczasowa rozmowa: ${input.digest}`)
  }
  if (input.degraded) {
    parts.push(`Uwaga: transkrypt źródłowy był niepełny (${input.degraded}) — zweryfikuj stan repo.`)
  }
  return parts.join(' ')
}
