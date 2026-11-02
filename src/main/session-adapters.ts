import { execFile } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import type { EngineId } from '../shared/types'
import type { Transcript } from './ledger'
import { resolveLaunch } from './resolve-launch'
import { codebuddyTranscript, ompTranscript, opencodeTranscript } from './session-transcripts'

const execFileP = promisify(execFile)

/** Never load an unbounded transcript into memory. */
const MAX_FILE = 8 * 1024 * 1024

function readCapped(file: string): string | null {
  try {
    if (statSync(file).size > MAX_FILE) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** Find `<handle><suffix>` one level under root, or any file under it whose name contains the handle. */
function findByHandle(root: string, handle: string, suffix: string): string | null {
  try {
    for (const dir of readdirSync(root)) {
      const nested = join(root, dir)
      const direct = join(nested, `${handle}${suffix}`)
      if (existsSync(direct)) return direct
      let entries: string[] = []
      try {
        entries = readdirSync(nested)
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.endsWith(suffix) && entry.includes(handle)) return join(nested, entry)
      }
    }
  } catch {
    /* store missing */
  }
  return null
}

export interface TranscriptRequest {
  cwd: string
  handle?: string
  /** resolved CLI path, when the provider scan found one */
  target?: string
}

/**
 * Read-only. Never writes into another CLI's store, never throws: an unreadable
 * store must degrade the checkpoint, not the app.
 */
export async function readTranscript(
  engine: EngineId,
  req: TranscriptRequest
): Promise<Transcript> {
  if (!req.handle) return { status: 'empty', reason: 'brak uchwytu sesji', events: [] }
  try {
    if (engine === 'opencode') {
      const { spawnFile, args } = resolveLaunch('opencode', req.target || 'opencode', [
        'session',
        'export',
        req.handle
      ])
      const { stdout } = await execFileP(spawnFile, args, {
        cwd: req.cwd,
        timeout: 20000,
        maxBuffer: MAX_FILE,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1' }
      })
      return opencodeTranscript(JSON.parse(stdout))
    }
    if (engine === 'omp') {
      const file = findByHandle(join(homedir(), '.omp', 'agent', 'sessions'), req.handle, '.jsonl')
      const text = file ? readCapped(file) : null
      return text
        ? ompTranscript(text)
        : { status: 'empty', reason: 'nie znaleziono pliku sesji', events: [] }
    }
    if (engine === 'codebuddy') {
      const file = findByHandle(join(homedir(), '.codebuddy', 'projects'), req.handle, '.jsonl')
      const text = file ? readCapped(file) : null
      return text
        ? codebuddyTranscript(text)
        : { status: 'empty', reason: 'nie znaleziono pliku sesji', events: [] }
    }
    return { status: 'degraded', reason: 'silnik bez adaptera', events: [] }
  } catch (err) {
    return {
      status: 'degraded',
      reason: err instanceof Error ? err.message.slice(0, 120) : 'odczyt nie powiódł się',
      events: []
    }
  }
}
