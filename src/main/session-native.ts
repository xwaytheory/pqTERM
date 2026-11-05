import { randomUUID } from 'crypto'
import type { TranscriptEvent } from './ledger'

export interface NativeSessionInput {
  /** fresh id the target CLI will be launched with */
  id: string
  title: string
  cwd: string
  events: TranscriptEvent[]
}

/** Prose only: a reasoning/tool replay would bloat every later turn. */
function prose(events: TranscriptEvent[]): TranscriptEvent[] {
  return events.filter((e) => (e.role === 'user' || e.role === 'assistant') && e.text.trim())
}

/**
 * CodeBuddy is a Claude-Code-shaped CLI: ~/.codebuddy/projects/<slug>/<uuid>.jsonl
 * with chained message rows. `codebuddy --resume <uuid>` renders the history.
 */
export function renderCodebuddySession(input: NativeSessionInput): string {
  const cwd = input.cwd.toLowerCase()
  const now = Date.now()
  const rows: Record<string, unknown>[] = [
    { type: 'session-meta', id: randomUUID(), sessionId: input.id, timestamp: now },
    {
      id: randomUUID(),
      timestamp: now,
      type: 'ai-title',
      aiTitle: input.title,
      sessionId: input.id,
      cwd
    }
  ]
  let parent: string | undefined
  for (const event of prose(input.events)) {
    const id = randomUUID()
    rows.push({
      id,
      ...(parent ? { parentId: parent } : {}),
      timestamp: now,
      type: 'message',
      role: event.role,
      content: [{ type: event.role === 'user' ? 'input_text' : 'output_text', text: event.text }],
      sessionId: input.id,
      cwd
    })
    parent = id
  }
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
}

/**
 * omp stores one jsonl per session under ~/.omp/agent/sessions/<project>/ and
 * resumes by id prefix (`omp -r <id>`).
 */
export interface OmpModel {
  provider: string
  model: string
}

/**
 * omp restores the model from the last assistant row and aborts on an unknown
 * one, so an imported session must carry a model this install actually has.
 * `modelRoles.default` in ~/.omp/agent/config.yml is exactly that.
 */
export function parseOmpDefaultModel(config: string): OmpModel | null {
  const line = config.match(/^\s*default:\s*([^\s#]+)/m)?.[1]
  if (!line) return null
  const at = line.indexOf('/')
  if (at < 1 || at === line.length - 1) return null
  return { provider: line.slice(0, at), model: line.slice(at + 1).replace(/:\w+$/, '') }
}

export function renderOmpSession(input: NativeSessionInput & { model?: OmpModel }): string {
  const now = new Date().toISOString()
  const rows: Record<string, unknown>[] = [
    // omp rewrites the title row in place; the pad keeps it the same byte length
    { type: 'title', v: 1, title: input.title, updatedAt: now, pad: ' '.repeat(110) },
    { type: 'session', version: 3, id: input.id, timestamp: now, cwd: input.cwd }
  ]
  let parent: string | null = null
  for (const event of prose(input.events)) {
    const id = randomUUID().replace(/-/g, '').slice(0, 8)
    rows.push({
      type: 'message',
      id,
      parentId: parent,
      timestamp: now,
      message:
        event.role === 'user'
          ? {
              role: 'user',
              content: [{ type: 'text', text: event.text }],
              attribution: 'user',
              timestamp: Date.now()
            }
          : {
              role: 'assistant',
              content: [{ type: 'text', text: event.text }],
              ...(input.model
                ? { api: 'openai-completions', provider: input.model.provider, model: input.model.model }
                : {}),
              timestamp: Date.now()
            }
    })
    parent = id
  }
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
}

/**
 * Grok keeps one folder per cwd (URL-encoded) with a summary.json and a
 * chat_history.jsonl; `grok -r <id>` replays it.
 */
export function grokSessionDir(cwd: string): string {
  // grok encodes the forward-slash form; a backslash-encoded folder is still
  // found by id but gets moved on first resume
  return encodeURIComponent(cwd.replace(/\\/g, '/'))
}

export interface GrokSession {
  summary: string
  history: string
}

export function renderGrokSession(
  input: NativeSessionInput & { model: string; home: string }
): GrokSession {
  const now = new Date().toISOString()
  const turns = prose(input.events)
  const summary = {
    info: { id: input.id, cwd: input.cwd },
    agent_id: `ag1.${randomUUID().replace(/-/g, '')}`,
    attempt_id: `at1.${randomUUID().replace(/-/g, '')}`,
    session_summary: input.title,
    created_at: now,
    updated_at: now,
    num_messages: turns.length,
    num_chat_messages: turns.length,
    current_model_id: input.model,
    next_trace_turn: 1,
    chat_format_version: 1,
    request_id: randomUUID(),
    grok_home: `${input.home}\\.grok`,
    last_active_at: now,
    generated_title: input.title,
    agent_name: 'grok-build-plan',
    sandbox_profile: 'off',
    reasoning_effort: 'high'
  }
  const history = turns.map((event) =>
    JSON.stringify(
      event.role === 'user'
        ? { type: 'user', content: [{ type: 'text', text: event.text }] }
        : { type: 'assistant', content: event.text, model_id: input.model }
    )
  )
  return { summary: JSON.stringify(summary, null, 2), history: history.join('\n') + '\n' }
}

/** CodeBuddy project folder name: every non-alphanumeric run becomes one dash. */
export function codebuddyProjectSlug(cwd: string): string {
  return cwd.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** omp folder name: the cwd relative to home, separators as dashes, leading dash. */
export function ompProjectSlug(cwd: string, home: string): string {
  // normalise both sides first: the app hands out `C:\…`, tests and the bridge
  // may hand out `C:/…`, and a leftover `C:` in a folder name is illegal on Windows
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const dir = norm(cwd)
  const base = norm(home)
  // omp keeps the original case in its folder names, so only the *comparison*
  // is case-insensitive
  const rel =
    dir.toLowerCase().startsWith(base.toLowerCase() + '/')
      ? dir.slice(base.length + 1)
      : dir.replace(/^[a-z]:\//i, '')
  return (
    '-' +
    rel
      .split('/')
      .filter(Boolean)
      // keep the case (omp's folders are `-Desktop-test`) and only strip the
      // characters Windows forbids in a folder name
      .map((part) => part.replace(/[<>:"/\\|?*]+/g, '-'))
      .join('-')
  )
}
