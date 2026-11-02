import type { Transcript, TranscriptEvent } from './ledger'

/** Bookkeeping rows every healthy session carries — not missing context. */
const OMP_IGNORED = new Set(['title', 'session', 'model_change', 'thinking_level_change', 'custom'])
const CODEBUDDY_IGNORED = new Set([
  'session-meta',
  'reasoning',
  'file-history-snapshot',
  'ai-title',
  'summary',
  'turn-metrics',
  'function_call'
])

/** A single event longer than this is noise for the next agent, not context. */
const MAX_EVENT = 4000

function clip(text: string): string {
  const t = text.trim()
  return t.length > MAX_EVENT ? `${t.slice(0, MAX_EVENT)}…` : t
}

/** CodeBuddy uses input_text/output_text; opencode and omp use text. */
const TEXT_BLOCKS = new Set(['text', 'input_text', 'output_text'])

function textOf(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .map((b) => {
      const block = b as { type?: string; text?: unknown }
      return block && TEXT_BLOCKS.has(block.type ?? '') && typeof block.text === 'string' ? block.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function finish(events: TranscriptEvent[], skipped: number, error?: string): Transcript {
  if (!events.length) return { status: 'empty', events, error }
  return skipped
    ? { status: 'degraded', reason: `pominięto ${skipped} nieznanych wpisów`, events, error }
    : { status: 'ok', events, error }
}

/** `opencode session export <id>` -> { info, messages[] } */
export function opencodeTranscript(raw: unknown): Transcript {
  const root = raw as { messages?: unknown } | null
  if (!root || !Array.isArray(root.messages)) {
    return { status: 'schemaUnknown', reason: 'brak messages[]', events: [] }
  }
  const events: TranscriptEvent[] = []
  let skipped = 0
  let error: string | undefined
  for (const item of root.messages) {
    const m = item as {
      type?: string
      text?: unknown
      content?: unknown
      name?: unknown
      state?: { status?: string }
      error?: { message?: unknown }
    }
    if (!m || typeof m !== 'object') {
      skipped++
      continue
    }
    // idle / synthetic are terminators and compaction markers, not turns
    if (m.type === 'idle' || m.type === 'synthetic') continue
    if (m.type === 'user') {
      if (typeof m.text === 'string' && m.text.trim()) events.push({ role: 'user', text: clip(m.text) })
      else skipped++
    } else if (m.type === 'assistant') {
      const text = textOf(m.content)
      if (text.trim()) events.push({ role: 'assistant', text: clip(text) })
      else if (typeof m.error?.message === 'string' && m.error.message.trim()) {
        // the turn died mid-flight (free-tier limit, provider 429) — that IS the handoff reason
        error = m.error.message
      } else skipped++
    } else if (m.type === 'tool') {
      // only failures earn a line in the checkpoint; 150 successful calls are noise
      if (m.state?.status === 'error') {
        const name = typeof m.name === 'string' ? m.name : 'tool'
        events.push({ role: 'tool', text: `${name} — błąd`, failed: true })
      }
    } else {
      skipped++
    }
  }
  return finish(events, skipped, error)
}

/** omp session jsonl: { type:'message', message:{ role, content[] } } */
export function ompTranscript(jsonl: string): Transcript {
  const events: TranscriptEvent[] = []
  let skipped = 0
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry: {
      type?: string
      message?: { role?: string; content?: unknown; isError?: boolean; toolName?: string }
    }
    try {
      entry = JSON.parse(trimmed)
    } catch {
      skipped++
      continue
    }
    if (entry.type !== 'message' || !entry.message) {
      // headers, model switches and UI markers are not turns — counting them as
      // "unknown" would flag every healthy omp session as degraded
      if (!OMP_IGNORED.has(entry.type ?? '')) skipped++
      continue
    }
    const msg = entry.message
    const text = textOf(msg.content)
    if (msg.role === 'user' && text.trim()) events.push({ role: 'user', text: clip(text) })
    else if (msg.role === 'assistant' && text.trim()) events.push({ role: 'assistant', text: clip(text) })
    else if (msg.role === 'toolResult') {
      if (msg.isError) {
        events.push({ role: 'tool', text: `${msg.toolName ?? 'tool'} — błąd`, failed: true })
      }
    } else if (msg.role !== 'user' && msg.role !== 'assistant') skipped++
  }
  return finish(events, skipped)
}

/** CodeBuddy project jsonl: message | function_call | function_call_result | (reszta pomijana) */
export function codebuddyTranscript(jsonl: string): Transcript {
  const events: TranscriptEvent[] = []
  let skipped = 0
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry: {
      type?: string
      role?: string
      content?: unknown
      name?: string
      isError?: boolean
      output?: { content?: unknown; isError?: boolean }
    }
    try {
      entry = JSON.parse(trimmed)
    } catch {
      skipped++
      continue
    }
    if (entry.type === 'message') {
      const text = typeof entry.content === 'string' ? entry.content : textOf(entry.content)
      // a tool-only turn has no prose — that is normal, not an unknown row
      if (entry.role === 'user' && text.trim()) events.push({ role: 'user', text: clip(text) })
      else if (entry.role === 'assistant' && text.trim())
        events.push({ role: 'assistant', text: clip(text) })
    } else if (entry.type === 'function_call_result') {
      if (entry.isError ?? entry.output?.isError) {
        events.push({ role: 'tool', text: `${entry.name ?? 'tool'} — błąd`, failed: true })
      }
    } else if (!CODEBUDDY_IGNORED.has(entry.type ?? '')) {
      skipped++
    }
  }
  return finish(events, skipped)
}
