import { app } from './host'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AppSnapshot, PaneState, ProviderInfo, Workspace } from '../shared/types'
import { DEFAULT_NOTIFICATIONS, DEFAULT_UI, looksLikePathTitle, sanitizeUi } from '../shared/types'
import { defaultProvider, ENGINE_SPECS } from './engines'
import { resolveProfileState } from './profile-state'

function saveFile(): string {
  return join(app.getPath('userData'), 'pq-state.json')
}

function empty(): AppSnapshot {
  return {
    user: null,
    google: { clientId: '', clientSecret: '' },
    workspaces: [],
    activeWorkspaceId: null,
    providers: ENGINE_SPECS.map((s) => defaultProvider(s)),
    sidebarOpen: true,
    notifications: { ...DEFAULT_NOTIFICATIONS },
    ui: { ...DEFAULT_UI }
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
  const file = resolveProfileState(app.getPath('userData'), existsSync)
  if (!file) return empty()
  try {
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as AppSnapshot
    const workspaces = (Array.isArray(parsed.workspaces) ? parsed.workspaces : []).map((w) => ({
      ...w,
      panes: Array.isArray(w.panes) ? w.panes.map(sanitizePane) : []
    }))
    return {
      ...empty(),
      ...parsed,
      google: parsed.google ?? { clientId: '', clientSecret: '' },
      notifications: {
        enabled: typeof parsed.notifications?.enabled === 'boolean'
          ? parsed.notifications.enabled : DEFAULT_NOTIFICATIONS.enabled,
        sound: typeof parsed.notifications?.sound === 'boolean'
          ? parsed.notifications.sound : DEFAULT_NOTIFICATIONS.sound
      },
      ui: sanitizeUi(parsed.ui, DEFAULT_UI),
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
  const temporary = `${file}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', flush: true })
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function existsState(): boolean {
  return resolveProfileState(app.getPath('userData'), existsSync) !== null
}

export function touchWorkspace(ws: Workspace): Workspace {
  return { ...ws, updatedAt: Date.now() }
}
