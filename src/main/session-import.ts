import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolveLaunch } from './resolve-launch'
import { parseOpencodeModels, type OpencodeModel } from './opencode-session'

const execFileP = promisify(execFile)

/** One resolution per app run; the model list changes only on upgrade. */
let cachedModel: OpencodeModel | null = null

/**
 * `opencode-default` is pqTERM's "pass no --model" sentinel, not a model the
 * vendor knows. Import accepts any model string but the session then refuses
 * every turn, so resolve a real `provider/model` first.
 */
export async function resolveOpencodeModel(target?: string): Promise<OpencodeModel | null> {
  if (cachedModel) return cachedModel
  try {
    const { spawnFile, args } = resolveLaunch('opencode', target || 'opencode', ['models'])
    const { stdout } = await execFileP(spawnFile, args, {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1' }
    })
    cachedModel = parseOpencodeModels(String(stdout))
    return cachedModel
  } catch {
    return null
  }
}

/**
 * Import a rendered session through opencode's own command — pqTERM never
 * writes into another CLI's store. Returns the session id on success.
 */
export async function importOpencodeSession(opts: {
  target?: string
  cwd: string
  file: string
}): Promise<string | null> {
  try {
    const { spawnFile, args } = resolveLaunch('opencode', opts.target || 'opencode', [
      'session',
      'import',
      '--directory',
      opts.cwd,
      opts.file
    ])
    const { stdout } = await execFileP(spawnFile, args, {
      cwd: opts.cwd,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1' }
    })
    const match = String(stdout).match(/Imported session:\s*(\S+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/** Remove an imported session when the switch it was made for did not land. */
export async function deleteOpencodeSession(opts: {
  target?: string
  cwd: string
  sessionId: string
}): Promise<void> {
  try {
    const { spawnFile, args } = resolveLaunch('opencode', opts.target || 'opencode', [
      'session',
      'delete',
      opts.sessionId
    ])
    await execFileP(spawnFile, args, {
      cwd: opts.cwd,
      timeout: 15000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1' }
    })
  } catch {
    /* the orphan is cosmetic; the switch already failed */
  }
}
