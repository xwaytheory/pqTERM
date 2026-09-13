import { app } from './host'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { AppSnapshot, PaneState, ProviderInfo, Workspace } from '../shared/types'
import { looksLikePathTitle } from '../shared/types'
import { defaultProvider, ENGINE_SPECS } from './engines'
import { runningDev } from './env'

function saveFile(): string {
  return join(app.getPath('userData'), 'pq-state.json')
}

/** Pre-rebrand profile dir (pqTERM-pr ← pq, pqTERM-dev ← pq-dev). */
function legacyDir(): string {
  return join(homedir(), 'AppData', 'Roaming', runningDev() ? 'pq-dev' : 'pq')
}

function loadFile(): string {
  const dest = saveFile()
  if (!existsSync(dest)) {
    // First boot under the pqTERM name — carry over workspaces/settings.
    const fromLegacy = join(legacyDir(), 'pq-state.json')
    if (existsSync(fromLegacy)) {
      mkdirSync(dirname(dest), { recursive: true })
      try {
        copyFileSync(fromLegacy, dest)
      } catch {
        /* ignore */
      }
      try {
        cpSync(join(legacyDir(), 'sessions'), join(dirname(dest), 'sessions'), {
          recursive: true
        })
      } catch {
        /* ignore */
      }
    }
  }
  const candidates = [dest, join(legacyDir(), 'pq-state.json')]
  return candidates.find((p) => existsSync(p)) ?? dest
}

function empty(): AppSnapshot {
  return {
    user: null,
    google: { clientId: '', clientSecret: '' },
    workspaces: [],
    activeWorkspaceId: null,
    providers: ENGINE_SPECS.map((s) => defaultProvider(s)),
    sidebarOpen: true
  }
}

function mergeProviders(saved: ProviderInfo[] | undefined): ProviderInfo[] {
  const byId = new Map((saved ?? []).map((p) => [p.id, p]))
  return ENGINE_SPECS.map((spec) => {
    const prev = byId.get(spec.id)
    const base = defaultProvider(spec)
    if (!prev) return base
    const models = spec.models.map((m) => {
      const old = prev.models.find((x) => x.id === m.id)
      return { ...m, enabled: old ? old.enabled : true }
    })
    return {
      ...base,
      enabled: prev.enabled,
      models,
      installed: prev.installed,
      detectedAuth: prev.detectedAuth,
      matchedEmail: prev.matchedEmail,
      resolvedPath: prev.resolvedPath
    }
  })
}

function sanitizePane(p: PaneState): PaneState {
  const engineName = ENGINE_SPECS.find((s) => s.id === p.engine)?.name ?? 'idle'
  const keep =
    Boolean(p.titleLocked) && Boolean(p.title?.trim()) && !looksLikePathTitle(p.title)
  return {
    ...p,
    title: keep ? p.title : engineName,
    titleLocked: keep
  }
}

export function loadState(): AppSnapshot {
  try {
    const raw = readFileSync(loadFile(), 'utf8')
    const parsed = JSON.parse(raw) as AppSnapshot
    const workspaces = (Array.isArray(parsed.workspaces) ? parsed.workspaces : []).map((w) => ({
      ...w,
      panes: Array.isArray(w.panes) ? w.panes.map(sanitizePane) : []
    }))
    return {
      ...empty(),
      ...parsed,
      google: parsed.google ?? { clientId: '', clientSecret: '' },
      providers: mergeProviders(parsed.providers),
      workspaces
    }
  } catch {
    return empty()
  }
}

export function saveState(state: AppSnapshot): void {
  const file = saveFile()
  mkdirSync(dirname(file), { recursive: true })
  const persist: AppSnapshot = {
    ...state,
    providers: state.providers.map((p) => ({
      ...p,
      // keep detection flags; they get refreshed on boot anyway
    }))
  }
  writeFileSync(file, JSON.stringify(persist, null, 2), 'utf8')
}

export function existsState(): boolean {
  return existsSync(loadFile())
}

export function touchWorkspace(ws: Workspace): Workspace {
  return { ...ws, updatedAt: Date.now() }
}
