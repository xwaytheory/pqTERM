import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { EngineId } from '../shared/types'
import type { TranscriptEvent } from './ledger'
import { renderOpencodeSession } from './opencode-session'
import { deleteOpencodeSession, importOpencodeSession, resolveOpencodeModel } from './session-import'
import {
  codebuddyProjectSlug,
  ompProjectSlug,
  parseOmpDefaultModel,
  renderCodebuddySession,
  renderOmpSession,
  type OmpModel
} from './session-native'

export interface CarryRequest {
  engine: EngineId
  /** resolved CLI path, when the provider scan found one */
  target?: string
  cwd: string
  title: string
  events: TranscriptEvent[]
  /** scratch dir for the opencode import document */
  workDir: string
}

export interface CarryResult {
  /** argv additions that make the new CLI open the imported conversation */
  args: string[]
  /** becomes the pane's sessionHandle, so a later hop can export it again */
  handle: string
  /** remove the imported session after a failed spawn or a lost pane */
  discard: () => void
}

function rmFile(file: string): () => void {
  return () => {
    try {
      unlinkSync(file)
    } catch {
      /* already gone */
    }
  }
}

/**
 * Give the target CLI the previous conversation as its own native session, so the
 * owner sees the same transcript instead of a seed line. Only engines with a
 * verified import path are here; everything else keeps checkpoint + seed.
 *
 * Read-only with respect to the source: nothing is written into the outgoing
 * CLI's store, and a failure returns null (the caller falls back to the seed).
 */
export async function carrySession(req: CarryRequest): Promise<CarryResult | null> {
  if (!req.events.length) return null
  try {
    if (req.engine === 'opencode') return await carryOpencode(req)
    if (req.engine === 'codebuddy') return carryCodebuddy(req)
    if (req.engine === 'omp') return carryOmp(req)
    return null
  } catch {
    return null
  }
}

async function carryOpencode(req: CarryRequest): Promise<CarryResult | null> {
  const model = await resolveOpencodeModel(req.target)
  if (!model) return null
  const id = `ses_${randomUUID().replace(/-/g, '').slice(0, 26)}`
  const file = join(req.workDir, 'opencode-import.json')
  writeFileSync(
    file,
    renderOpencodeSession({ id, title: req.title, cwd: req.cwd, events: req.events, model })
  )
  try {
    const imported = await importOpencodeSession({ target: req.target, cwd: req.cwd, file })
    if (imported !== id) {
      if (imported) void deleteOpencodeSession({ target: req.target, cwd: req.cwd, sessionId: imported })
      return null
    }
  } finally {
    rmFile(file)()
  }
  return {
    args: ['--session', id],
    handle: id,
    discard: () => void deleteOpencodeSession({ target: req.target, cwd: req.cwd, sessionId: id })
  }
}

function carryCodebuddy(req: CarryRequest): CarryResult | null {
  const id = randomUUID()
  const dir = join(homedir(), '.codebuddy', 'projects', codebuddyProjectSlug(req.cwd))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${id}.jsonl`)
  writeFileSync(file, renderCodebuddySession({ id, title: req.title, cwd: req.cwd, events: req.events }))
  return { args: ['--resume', id], handle: id, discard: rmFile(file) }
}

function carryOmp(req: CarryRequest): CarryResult | null {
  const model = readOmpModel()
  // without a model this install knows, omp aborts the resume — leave it to the seed
  if (!model) return null
  const id = randomUUID()
  const dir = join(homedir(), '.omp', 'agent', 'sessions', ompProjectSlug(req.cwd, homedir()))
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dir, `${stamp}_${id}.jsonl`)
  writeFileSync(file, renderOmpSession({ id, title: req.title, cwd: req.cwd, events: req.events, model }))
  return { args: ['-r', id], handle: id, discard: rmFile(file) }
}

function readOmpModel(): OmpModel | null {
  try {
    return parseOmpDefaultModel(readFileSync(join(homedir(), '.omp', 'agent', 'config.yml'), 'utf8'))
  } catch {
    return null
  }
}
