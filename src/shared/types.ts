export type EngineId =
  | 'grok'
  | 'omp'
  | 'pi'
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
  | 'antigravity'
  | 'zcode'
  | 'ori'
  | 'cursor'
  | 'freebuff'
  | 'kimi'
  | 'cline'
  | 'qoder'
  | 'baicode'
  | 'kilocode'
  | 'codebuddy'
  | 'shell'
  | 'cmd'

/** Lifecycle actions a CLI tile may expose; main decides which ones have a safe script. */
export type EngineAction = 'install' | 'update' | 'uninstall'

export function isRawShell(id: EngineId): boolean {
  return id === 'shell' || id === 'cmd'
}

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
  for (const id of ENGINE_ORDER) {
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
  /** Actions with a ready script; computed in main from the engine spec. */
  actions: EngineAction[]
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
  /** pqTERM-minted lineage id; names the checkpoint directory for this conversation */
  sessionId?: string
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

export type PaneActivityKind = 'running' | 'quiet' | 'ready' | 'waiting' | 'attention' | 'exited' | 'error'

export interface PaneActivity {
  kind: PaneActivityKind
  at: number
  unread: boolean
}

/** A CLI that is working *right now* — the sidebar's animated rail/dot show
 *  exactly this. Only `running` counts: quiet, waiting, attention, exited and
 *  error are states a session passes through, not work in progress, and an empty
 *  input box proves nothing (a busy TUI looks identical — see pane-activity). */
export function isPaneWorking(
  pane: Pick<PaneState, 'id' | 'engine'>,
  activity: Record<string, PaneActivity>
): boolean {
  return Boolean(pane.engine) && activity[pane.id]?.kind === 'running'
}

export interface NotificationSettings {
  enabled: boolean
  sound: boolean
}

export const ACTIVITY_LABELS: Record<PaneActivityKind, string> = {
  running: 'aktywność CLI',
  quiet: 'brak nowego wyjścia',
  ready: 'odpowiedź gotowa',
  waiting: 'czeka na Ciebie',
  attention: 'CLI wymaga uwagi',
  exited: 'proces zakończony',
  error: 'błąd sesji'
}

/**
 * UI accent. `mono` is the default: pqTERM's own chrome (bars, borders, focus,
 * badges, buttons) is grayscale, while terminal output keeps normal ANSI colour —
 * CLI colour is data (diffs, git status, logs), not theme.
 */
export type AccentId = 'mono' | 'mint' | 'blue' | 'amber'
export const ACCENT_IDS: readonly AccentId[] = ['mono', 'mint', 'blue', 'amber']

export type CursorStyleId = 'bar' | 'block' | 'underline'
export const CURSOR_STYLE_IDS: readonly CursorStyleId[] = ['bar', 'block', 'underline']

/** Terminal font. An id, not a free string: the renderer cannot inject CSS families. */
export type FontId = 'cascadia' | 'consolas' | 'jetbrains' | 'ibmplex'
export const FONT_IDS: readonly FontId[] = ['cascadia', 'consolas', 'jetbrains', 'ibmplex']
export const FONT_STACKS: Record<FontId, string> = {
  cascadia: 'Cascadia Mono, Cascadia Code, Consolas, monospace',
  consolas: 'Consolas, Courier New, monospace',
  jetbrains: 'JetBrains Mono, Cascadia Mono, Consolas, monospace',
  ibmplex: 'IBM Plex Mono, Cascadia Mono, Consolas, monospace'
}

/** Whole-app settings, persisted as `state.ui` in pq-state.json. */
export interface UiSettings {
  accent: AccentId
  fontId: FontId
  /** terminal font size in css px — feeds fit(), so main clamps it too */
  fontSize: number
  cursorStyle: CursorStyleId
  cursorBlink: boolean
  /** terminal scrollback lines (0 = no scrollback) */
  scrollback: number
  /** whole-GUI Chromium zoom factor (Ctrl+wheel / Ctrl+plus-minus), 0.5–2 */
  zoom: number
  /** SPAWN ENGINE favourites, in the order the user starred them. */
  favoriteEngines: EngineId[]
}

export const DEFAULT_UI: UiSettings = {
  accent: 'mono',
  fontId: 'cascadia',
  fontSize: 13,
  cursorStyle: 'bar',
  cursorBlink: true,
  scrollback: 4000,
  zoom: 1,
  favoriteEngines: []
}

export const UI_FONT_MIN = 9
export const UI_FONT_MAX = 20
export const UI_SCROLLBACK_MAX = 50000
export const UI_ZOOM_MIN = 0.5
export const UI_ZOOM_MAX = 2

const clampInt = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(v)))

/** zoom is a float and wheel steps multiply it — clamp to the band, keep two decimals */
const clampZoom = (v: number): number => Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, Math.round(v * 100) / 100))

/**
 * One validator for `ui`, used by the IPC handler and by the state loader, so a
 * hand-edited pq-state.json cannot hand the renderer a font size of 4000 or an
 * accent that does not exist. Anything invalid falls back to `base`.
 */
export function sanitizeUi(patch: Partial<UiSettings> | undefined, base: UiSettings = DEFAULT_UI): UiSettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<UiSettings>
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  return {
    accent: ACCENT_IDS.includes(p.accent as AccentId) ? (p.accent as AccentId) : base.accent,
    fontId: FONT_IDS.includes(p.fontId as FontId) ? (p.fontId as FontId) : base.fontId,
    cursorStyle: CURSOR_STYLE_IDS.includes(p.cursorStyle as CursorStyleId)
      ? (p.cursorStyle as CursorStyleId)
      : base.cursorStyle,
    cursorBlink: typeof p.cursorBlink === 'boolean' ? p.cursorBlink : base.cursorBlink,
    fontSize: num(p.fontSize) ? clampInt(p.fontSize, UI_FONT_MIN, UI_FONT_MAX) : base.fontSize,
    scrollback: num(p.scrollback) ? clampInt(p.scrollback, 0, UI_SCROLLBACK_MAX) : base.scrollback,
    zoom: num(p.zoom) ? clampZoom(p.zoom) : base.zoom,
    // Engine ids are a closed set and the renderer owns the order. Drop junk,
    // dedupe, and never alias the default array (callers may replace it).
    favoriteEngines: Array.isArray(p.favoriteEngines)
      ? [...new Set(p.favoriteEngines)].filter((id): id is EngineId =>
          ENGINE_ORDER.includes(id as EngineId)
        )
      : [...base.favoriteEngines]
  }
}

export interface AppSnapshot {
  user: UserSession | null
  google: GoogleOAuthConfig
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  providers: ProviderInfo[]
  sidebarOpen: boolean
  notifications: NotificationSettings
  ui: UiSettings
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: true,
  sound: false
}

export const ENGINE_ORDER: EngineId[] = [
  'grok',
  'omp',
  'pi',
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
  'antigravity',
  'zcode',
  'ori',
  'cursor',
  'freebuff',
  'kimi',
  'cline',
  'qoder',
  'baicode',
  'kilocode',
  'codebuddy',
  'shell',
  'cmd'
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

/** Hard cap for panes in one workspace. The 21st add is refused. */
export const MAX_PANES = 20

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
