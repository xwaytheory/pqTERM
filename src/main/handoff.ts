import type { EngineId } from '../shared/types'

export interface HandoffSeedInput {
  checkpointPath: string
  sourceEngine: EngineId | null
  targetEngine: EngineId
  /** set when the source transcript could not be read in full */
  degraded?: string
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
    `Kontekst: ${input.checkpointPath}`,
    'Przeczytaj ten plik w całości, sprawdź `git status` i kontynuuj od ostatniej prośby użytkownika.',
    'Nie powtarzaj pracy, która jest już zrobiona.'
  ]
  if (input.degraded) {
    parts.push(`Uwaga: transkrypt źródłowy był niepełny (${input.degraded}) — zweryfikuj stan repo.`)
  }
  return parts.join(' ')
}
