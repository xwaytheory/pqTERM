export { pickActiveTitle } from './db-title'

import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolveLaunch } from './resolve-launch'

const execFileP = promisify(execFile)

/**
 * Query the opencode DB for the most recently updated session matching `cwd`
 * and return its full title. Falls back to null when offline / empty.
 */
export async function queryActiveOpenCodeTitle(cwd: string, resolvedPath?: string): Promise<string | null> {
  const { spawnFile, args } = resolveLaunch('opencode', resolvedPath ?? 'opencode', [
    'db',
    'select directory, title, time_updated from session where time_archived is null',
    '--format',
    'json'
  ])
  const { stdout } = await execFileP(spawnFile, args, {
    timeout: 15000,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' }
  })
  const rows = JSON.parse(stdout) as Array<{ directory?: string; title?: string; time_updated?: number }>
  return (await import('./db-title')).pickActiveTitle(rows, cwd)
}
