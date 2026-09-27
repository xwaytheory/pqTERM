import { join } from 'path'

/** This profile's pq-state.json, or null when that file has never been saved.
 *  No other directory is consulted. A GitHub clone on a new computer stays empty. */
export function resolveProfileState(
  userDataDir: string,
  exists: (path: string) => boolean
): string | null {
  const own = join(userDataDir, 'pq-state.json')
  return exists(own) ? own : null
}
