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
  model?: string
}

export interface Workspace {
  id: string
  title: string
  cwd: string
  layout: LayoutId
  panes: PaneState[]
  createdAt: number
  updatedAt: number
}

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
