import { pickActiveTitle } from './db-title'
import { opencodeSessionRows } from './resume'

/**
 * Return the most recently updated opencode session title for `cwd`.
 * Falls back to null when offline / empty.
 *
 * NOTE: the imports above stay extensionless — this module is compiled as part of
 * `src/main` (tsconfig.node.json rejects explicit `.ts` specifiers, TS5097). The
 * unit test targets `db-title` directly, which is where the logic lives.
 */
export async function queryActiveOpenCodeTitle(
  cwd: string,
  resolvedPath?: string
): Promise<string | null> {
  const rows = await opencodeSessionRows(cwd, resolvedPath ?? 'opencode')
  return pickActiveTitle(rows, cwd)
}
