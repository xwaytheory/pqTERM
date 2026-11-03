import { isRawShell, type EngineId, type ProviderInfo } from './types.ts'

/**
 * Engines whose conversation pqTERM can read (src/main/session-adapters.ts).
 * "Z kontekstem" stays disabled for any other source: the checkpoint would
 * carry repo state but no transcript, which reads like context and is not.
 */
export const CONTEXT_SOURCES: readonly EngineId[] = ['opencode', 'omp', 'codebuddy']

export function canSwitchWithContext(current: EngineId | null): boolean {
  return current !== null && CONTEXT_SOURCES.includes(current)
}

/**
 * Targets for the session engine menu: enabled engines except the one already
 * running, favourites first (in the user's starring order), then the rest,
 * raw shells last. Uninstalled CLIs stay in the list (disabled) so the menu
 * explains why they cannot be picked instead of silently hiding them.
 */
export function switchTargets(
  providers: ProviderInfo[],
  favorites: readonly EngineId[],
  current: EngineId | null
): ProviderInfo[] {
  const usable = providers.filter((p) => p.id !== current && (p.enabled || isRawShell(p.id)))
  const rank = (id: EngineId): number => {
    const i = favorites.indexOf(id)
    return i === -1 ? favorites.length : i
  }
  const agents = usable
    .filter((p) => !isRawShell(p.id))
    .sort((a, b) => rank(a.id) - rank(b.id) || Number(b.installed) - Number(a.installed))
  const shells = usable.filter((p) => isRawShell(p.id))
  return [...agents, ...shells]
}
