import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { EngineId } from '../shared/types'

/** How much of an engine's own store we managed to read. */
export type AdapterStatus = 'ok' | 'empty' | 'degraded' | 'schemaUnknown'

export interface TranscriptEvent {
  role: 'user' | 'assistant' | 'tool'
  text: string
  /** tool event that ended in an error */
  failed?: boolean
}

export interface Transcript {
  status: AdapterStatus
  reason?: string
  events: TranscriptEvent[]
  /** why the last turn never completed (quota, rate limit, provider error) */
  error?: string
}

export interface CheckpointInput {
  sessionId: string
  engine: EngineId
  handle?: string
  cwd: string
  transcript: Transcript
  /** repo-wide `git status --porcelain` lines; shared by every pane in the workspace */
  changes?: string[]
  now?: number
}

export const CHECKPOINT_VERSION = 1

const MAX_USER = 1200
const MAX_ASSISTANT = 2000
const MAX_FAILED = 5
const MAX_CHANGES = 30

export function mintSessionId(): string {
  return randomUUID()
}

export function checkpointRoot(base: string, profile: string): string {
  return join(base, profile, 'sessions')
}

export function checkpointDir(root: string, sessionId: string): string {
  return join(root, sessionId)
}

function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function lastOf(events: TranscriptEvent[], role: 'user' | 'assistant'): TranscriptEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].role === role) return events[i]
  return undefined
}

/**
 * Render a checkpoint a *different* CLI can act on. Deliberately plain markdown:
 * it has to survive every engine's version bump, and the receiving agent reads it
 * with its own file tools. Provenance is part of the artifact — an agent must be
 * able to tell a full transcript from a degraded one before trusting it.
 */
export function renderCheckpoint(input: CheckpointInput): string {
  const { transcript } = input
  const written = new Date(input.now ?? Date.now()).toISOString()
  const user = lastOf(transcript.events, 'user')
  const assistant = lastOf(transcript.events, 'assistant')
  const failed = transcript.events.filter((e) => e.role === 'tool' && e.failed).slice(-MAX_FAILED)
  const changes = (input.changes ?? []).slice(0, MAX_CHANGES)
  const statusLine = transcript.reason ? `${transcript.status} (${transcript.reason})` : transcript.status
  const head = [
    '<!-- pq-checkpoint v' + CHECKPOINT_VERSION,
    `session: ${input.sessionId}`,
    `engine: ${input.engine}`,
    `handle: ${input.handle ?? 'none'}`,
    `cwd: ${input.cwd}`,
    `written: ${written}`,
    `transcript: ${statusLine}`,
    `events: ${transcript.events.length}`,
    '-->'
  ].join('\n')
  const warning =
    transcript.status === 'ok'
      ? '> Kontekst pochodzi z natywnego transkryptu CLI.'
      : `> Transkrypt niepełny (${statusLine}). Zweryfikuj stan repo, zanim zaczniesz edytować.`
  const body = [
    head,
    '',
    `# Checkpoint — ${input.engine}`,
    '',
    warning,
    '',
    ...(transcript.error
      ? ['## Błąd ostatniej tury', '', `\`\`\`text\n${clip(transcript.error, 400)}\n\`\`\``, '']
      : []),
    '## Ostatnia prośba użytkownika',
    '',
    user ? clip(user.text, MAX_USER) : '_(brak w transkrypcie)_',
    '',
    '## Ostatnia ukończona odpowiedź',
    '',
    assistant ? clip(assistant.text, MAX_ASSISTANT) : '_(brak w transkrypcie)_',
    '',
    '## Nieudane wywołania narzędzi',
    '',
    failed.length ? failed.map((e) => `- ${clip(e.text, 300)}`).join('\n') : '_(brak)_',
    '',
    '## Zmiany w repo',
    '',
    'Wspólne dla całego workspace — mogą zawierać pracę innych paneli.',
    '',
    '```text',
    changes.length ? changes.join('\n') : '(czysto)',
    '```',
    ''
  ]
  return body.join('\n')
}

/** Append-only: a second handoff must not erase the first. Returns null on any IO failure. */
export function writeCheckpoint(root: string, input: CheckpointInput): string | null {
  try {
    const dir = checkpointDir(root, input.sessionId)
    mkdirSync(dir, { recursive: true })
    let n = 1
    while (existsSync(join(dir, `checkpoint.${n}.md`))) n++
    const target = join(dir, `checkpoint.${n}.md`)
    const tmp = `${target}.tmp`
    writeFileSync(tmp, renderCheckpoint(input), 'utf8')
    renameSync(tmp, target)
    return target
  } catch {
    return null
  }
}

/** Checkpoints for one session, oldest first. */
export function listCheckpoints(root: string, sessionId: string): string[] {
  try {
    const dir = checkpointDir(root, sessionId)
    return readdirSync(dir)
      .filter((f) => /^checkpoint\.\d+\.md$/.test(f))
      .sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1]))
      .map((f) => join(dir, f))
  } catch {
    return []
  }
}

export function removeCheckpoint(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    /* ignore */
  }
}
