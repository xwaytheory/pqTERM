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

/** Any number of panes is allowed (the UI shows presets, +/- stepper, and drag-to-snap). */
export type LayoutId = number

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
  /** Optional letter-mark / monogram asset (from EngineSpec.logo). */
  logo?: string
  /** Optional icon asset (from EngineSpec.icon); falls back to logo / letter. */
  icon?: string
  /** Optional monogram override (two-letter collision marks). */
  mark?: string
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
  /** normalized rectangle [0..1] this pane occupies in the workspace grid. */
  area?: PaneArea
}

/** Normalized rectangle (unit space 0..1) of a pane in the workspace grid. */
export interface PaneArea {
  x: number
  y: number
  w: number
  h: number
}

/** Aero-Snap-like zones a dragged pane can fill. */
export type SnapZone = 'full' | 'left' | 'right' | 'top' | 'bottom' | 'tl' | 'tr' | 'bl' | 'br'

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

/** Preset buttons shown in layout pickers. Any LayoutId is allowed via +/- stepper. */
export const LAYOUTS: LayoutId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]

export function paneCount(layout: LayoutId): number {
  return layout
}

/** Best-fit uniform grid (legacy uniform layouts; pane areas are the real source of truth). */
export function gridTemplate(layout: LayoutId): { cols: number; rows: number } {
  const n = Math.max(1, layout)
  const cols = Math.ceil(Math.sqrt(n))
  return { cols, rows: Math.ceil(n / cols) }
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

export type UpdatePhase =
  | 'disabled' // dev mode / brak wsparcia (brak git itd.) — aktualizacje wyłączone
  | 'checking' // trwa sprawdzanie
  | 'uptodate' // sprawdzono — najnowsza wersja
  | 'available' // jest nowsza wersja, czeka na akcję
  | 'applying' // aktualizacja w toku, app zrestartuje się sam
  | 'applied' // świeżo po aktualizacji (komunikat 1 raz)
  | 'error' // sprawdzanie/aktualizacja nie powiodły się

/** Co konkretnie updater zrobi po pobraniu zmian (kroki maszynowe). */
export interface UpdateSteps {
  install: boolean // npm install (package.json / package-lock.json się zmieniły)
  stamp: boolean // refresh host/ (binarka electron się zmieniła)
  build: boolean // npm run build (src/renderer/main/preload/phone się zmieniły)
}

export interface UpdateStatus {
  phase: UpdatePhase
  channel: string
  currentVersion: string
  currentCommit: string
  nextVersion?: string
  nextCommit?: string
  commitsBehind: number
  message: string
  steps: UpdateSteps
  lastCheckAt?: number
  lastAppliedAt?: number
  lastAppliedVersion?: string
  ignoredVersion?: string
  error?: string
  logPath?: string
}

/** Job zlecony detached updaterowi (scripts/updater.cjs). */
export interface UpdateJob {
  id: string
  root: string
  channel: string
  targetCommit: string
  targetVersion: string
  exePath: string
  exeArgs: string[]
  relaunch: boolean
  steps: UpdateSteps
  appPid?: number
  updaterPid?: number
  ts: number
}

export function compareVersions(a: string, b: string): number {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}
