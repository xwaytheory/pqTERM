import type { TranscriptEvent } from './ledger'

export interface OpencodeModel {
  id: string
  providerID: string
}

/** import recomputes the project from --directory; only the shape is validated */
const PLACEHOLDER_PROJECT = '0123456789abcdef0123456789abcdef01234567'

export interface OpencodeImportInput {
  /** fresh ses_… id; import preserves it, so the caller can launch --session */
  id: string
  title: string
  cwd: string
  events: TranscriptEvent[]
  /** a real `provider/model` from `opencode models`; the sentinel alias is not one */
  model: OpencodeModel
}

/**
 * Parse `opencode models` output. Prefer the built-in `opencode` provider: it is
 * authenticated by default, while a third-party line may be listed but unusable.
 * A model id may itself contain slashes, so split on the first one only.
 */
export function parseOpencodeModels(stdout: string): OpencodeModel | null {
  let fallback: OpencodeModel | null = null
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^([^/\s]+)\/(\S+)$/)
    if (!match) continue
    const model = { providerID: match[1], id: match[2] }
    if (model.providerID === 'opencode') return model
    fallback ??= model
  }
  return fallback
}

/** Prose turns only: reasoning and successful tool calls are not the visible
 *  conversation, and importing them would bloat every later turn. */
function prose(events: TranscriptEvent[]): TranscriptEvent[] {
  return events.filter((e) => (e.role === 'user' || e.role === 'assistant') && e.text.trim())
}

/**
 * Build the JSON that `opencode session import` accepts (the same shape as
 * `opencode session export`). Pure and deterministic for tests.
 */
export function renderOpencodeSession(input: OpencodeImportInput): string {
  const now = Date.now()
  const messages: Record<string, unknown>[] = []
  let at = now
  for (const event of prose(input.events)) {
    const id = `msg_${input.id.slice(4)}_${messages.length}`
    if (event.role === 'user') {
      messages.push({
        id,
        time: { created: at++ },
        text: event.text,
        files: [],
        agents: [],
        type: 'user'
      })
    } else {
      messages.push({
        id,
        time: { created: at, completed: at + 1 },
        type: 'assistant',
        agent: 'build',
        model: input.model,
        content: [{ type: 'text', text: event.text }]
      })
      at += 2
    }
  }
  return JSON.stringify(
    {
      info: {
        id: input.id,
        projectID: PLACEHOLDER_PROJECT,
        agent: 'build',
        model: input.model,
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        outcome: 'succeeded',
        time: { created: now, updated: at },
        title: input.title,
        location: { directory: input.cwd }
      },
      messages
    },
    null,
    1
  )
}
