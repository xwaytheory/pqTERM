export type EngineId =
  | 'grok'
  | 'omp'
  | 'hermes'
  | 'opencode'
  | 'codex'
  | 'claude'
  | 'qwen'
  | 'dsh'
  | 'gemini'
  | 'crush'
  | 'aider'
  | 'copilot'
  | 'shell'

export type LayoutId = 1 | 2 | 3 | 4 | 6 | 9

/** User asked the grid (not the CLI) to run something in sibling panes. */
export function parseGridIntent(
  line: string
): { engine?: EngineId; prompt: string } | null {
  const t = line.trim()
  if (!t) return null
  const wantsOthers =
    /(pozosta[łl]\w*|w reszcie|innych okn|wszystk\w*\s+okn|other panes?|remaining panes?|all panes?|wszystkich pane|w pozosta)/i.test(
      t
    )
  if (!wantsOthers) return null
  let prompt = ''
  const quoted = t.match(/[„""](.+?)[”""]/)
  const labeled = t.match(/(?:prompt|zadaj|napisz|powiedz)\s*[:–-]\s*(.+)$/i)
  if (quoted) prompt = quoted[1].trim()
  else if (labeled) prompt = labeled[1].replace(/^[„""]|[”""]$/g, '').trim()
  let engine: EngineId | undefined
  const ids: EngineId[] = [
    'grok',
    'omp',
    'hermes',
    'opencode',
    'codex',
    'claude',
    'qwen',
    'dsh',
    'gemini',
    'crush',
    'aider',
    'copilot'
  ]
  for (const id of ids) {
    if (new RegExp(`\\b${id}\\b`, 'i').test(t)) {
      engine = id
      break
    }
  }
  if (/claude\s*code/i.test(t)) engine = 'claude'
  return { engine, prompt }
}

export type AuthProvider = 'google' | 'local'

export interface UserSession {
  email: string
  name: string
  picture?: string
  provider: AuthProvider
  signedInAt: number
}

export interface ModelChoice {
  id: string
  name: string
  enabled: boolean
}

export interface ProviderInfo {
  id: EngineId
  name: string
  vendor: string
  command: string
  args: string[]
  color: string
  installed: boolean
  detectedAuth: boolean
  matchedEmail?: string
  resolvedPath?: string
  enabled: boolean
  models: ModelChoice[]
  hint: string
}

export interface PaneState {
  id: string
  engine: EngineId | null
  title: string
  /** user typed this title — auto-title from prompt/OSC must not overwrite */
  titleLocked?: boolean
  model?: string
  /** engine-native id of the agent conversation this pane should resume */
  sessionHandle?: string
}

export interface Workspace {
  id: string
  title: string
  cwd: string
  layout: LayoutId
  panes: PaneState[]
  /** when set, that pane fills the grid; other panes stay alive but hidden */
  zoomedPaneId?: string | null
  createdAt: number
  updatedAt: number
}

export function clipTitle(raw: string, max = 42): string {
  const t = raw
    .replace(/\s+/g, ' ')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function isDefaultPaneTitle(title: string, engineName?: string): boolean {
  const t = title.trim()
  if (!t || t === 'idle') return true
  if (/^pane \d+$/i.test(t)) return true
  if (engineName && t.toLowerCase() === engineName.toLowerCase()) return true
  return false
}

export function looksLikePathTitle(title: string): boolean {
  const t = title.trim()
  if (!t) return false
  if (/^[A-Za-z]:[\\/]/.test(t)) return true
  if (/[\\/]/.test(t) && /\.(exe|cmd|bat|js|mjs|dll)$/i.test(t)) return true
  return false
}

export interface PanePatch {
  engine?: EngineId | null
  model?: string
  title?: string
  titleLocked?: boolean
}

export interface UsageWindow {
  id: string
  label: string
  usedPct: number
  resetAt?: number
}

export interface EngineUsage {
  engine: EngineId
  plan?: string
  windows: UsageWindow[]
  note?: string
  fetchedAt: number
}

export type UsageMap = Partial<Record<EngineId, EngineUsage>>

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
}

export interface AppSnapshot {
  user: UserSession | null
  google: GoogleOAuthConfig
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  providers: ProviderInfo[]
  sidebarOpen: boolean
}

export const ENGINE_ORDER: EngineId[] = [
  'grok',
  'omp',
  'hermes',
  'opencode',
  'codex',
  'claude',
  'qwen',
  'dsh',
  'gemini',
  'crush',
  'aider',
  'copilot',
  'shell'
]

export interface SyncEvent {
  running: boolean
  current?: string
  line: string
  done: number
  total: number
}

export type BoardRelation = 'independent' | 'related' | 'overlap'

export interface BoardPane {
  paneId: string
  engine: string
  title: string
  files: string[]
  alive: boolean
}

export interface BoardNote {
  relation: BoardRelation
  engines: string[]
  detail: string
}

export interface BoardSnapshot {
  cwd: string
  boardPath: string
  updatedAt: number
  panes: BoardPane[]
  git: string[]
  notes: BoardNote[]
}

export const LAYOUTS: LayoutId[] = [1, 2, 3, 4, 6, 9]

export function paneCount(layout: LayoutId): number {
  return layout
}

export function gridTemplate(layout: LayoutId): { cols: number; rows: number } {
  switch (layout) {
    case 1:
      return { cols: 1, rows: 1 }
    case 2:
      return { cols: 2, rows: 1 }
    case 3:
      return { cols: 3, rows: 1 }
    case 4:
      return { cols: 2, rows: 2 }
    case 6:
      return { cols: 3, rows: 2 }
    case 9:
      return { cols: 3, rows: 3 }
  }
}

export interface RemoteInfo {
  enabled: boolean
  pin: string
  port: number
  urls: string[]
  wanUrl: string | null
  tunnel: 'off' | 'starting' | 'up' | 'error'
  tunnelError: string
  clients: number
}
