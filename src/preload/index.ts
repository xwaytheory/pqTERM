import { contextBridge, ipcRenderer, webUtils } from './host'
import type {
  AppSnapshot,
  EngineId,
  GoogleOAuthConfig,
  LayoutId,
  NotificationSettings,
  PaneActivity,
  ProviderInfo,
  SyncEvent,
  BoardSnapshot,
  PanePatch,
  RemoteInfo,
  SnapZone,
  UsageMap,
  UserSession,
  Workspace
} from '../shared/types'
import type { ResizeEdge } from '../shared/grid'

function scrub(e: unknown): Error {
  const m = e instanceof Error ? e.message : String(e)
  return new Error(
    m
      .replace(/^Error invoking remote method '[^']+': (Error: )?/i, '')
      .replace(/electron/gi, 'pq')
  )
}

function invoke(channel: string, ...args: unknown[]): Promise<any> {
  return ipcRenderer.invoke(channel, ...args).catch((e) => {
    throw scrub(e)
  })
}

const pq = {
  app: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    version: () => invoke('app:version') as Promise<string>,
    info: () =>
      invoke('app:info') as Promise<{
        mode: 'dev' | 'prod'
        name: string
        edition: 'pq' | 'dev' | 'test'
        build: number
        version: string
      }>,
    toggleSidebar: () => invoke('app:toggleSidebar') as Promise<void>,
    openUrl: (url: string) => invoke('app:openUrl', url) as Promise<void>
  },
  remote: {
    info: () => invoke('remote:info') as Promise<RemoteInfo>,
    start: () => invoke('remote:start') as Promise<RemoteInfo>,
    stop: () => invoke('remote:stop') as Promise<RemoteInfo>,
    regenPin: () => invoke('remote:regenPin') as Promise<RemoteInfo>,
    onChange: (cb: (info: RemoteInfo) => void) => {
      const fn = (_: unknown, info: RemoteInfo) => cb(info)
      ipcRenderer.on('remote:changed', fn)
      return () => {
        ipcRenderer.removeListener('remote:changed', fn)
      }
    }
  },
  sync: {
    start: () => invoke('sync:start') as Promise<void>,
    last: () => invoke('sync:last') as Promise<SyncEvent>,
    onEvent: (cb: (ev: SyncEvent) => void) => {
      const fn = (_: unknown, ev: SyncEvent) => cb(ev)
      ipcRenderer.on('sync:event', fn)
      return () => ipcRenderer.removeListener('sync:event', fn)
    }
  },
  usage: {
    get: () => invoke('usage:get') as Promise<UsageMap>,
    onChange: (cb: (m: UsageMap) => void) => {
      const fn = (_: unknown, m: UsageMap) => cb(m)
      ipcRenderer.on('usage:changed', fn)
      return () => ipcRenderer.removeListener('usage:changed', fn)
    }
  },
  activity: {
    get: () => invoke('activity:get') as Promise<Record<string, PaneActivity>>,
    focus: (workspaceId: string | null, paneId: string | null) =>
      invoke('activity:focus', workspaceId, paneId) as Promise<void>,
    onChange: (cb: (paneId: string, activity: PaneActivity | null) => void) => {
      const fn = (_: unknown, paneId: string, activity: PaneActivity | null) => cb(paneId, activity)
      ipcRenderer.on('activity:changed', fn)
      return () => ipcRenderer.removeListener('activity:changed', fn)
    },
    onFocus: (cb: (workspaceId: string, paneId: string) => void) => {
      const fn = (_: unknown, workspaceId: string, paneId: string) => cb(workspaceId, paneId)
      ipcRenderer.on('activity:focus', fn)
      return () => ipcRenderer.removeListener('activity:focus', fn)
    }
  },
  notifications: {
    set: (settings: NotificationSettings) => invoke('notifications:set', settings) as Promise<void>
  },
  board: {
    get: () => invoke('board:get') as Promise<BoardSnapshot | null>,
    onChange: (cb: (snap: BoardSnapshot) => void) => {
      const fn = (_: unknown, snap: BoardSnapshot) => cb(snap)
      ipcRenderer.on('board:changed', fn)
      return () => ipcRenderer.removeListener('board:changed', fn)
    }
  },
  state: {
    load: () => invoke('state:load') as Promise<AppSnapshot>,
    onChange: (cb: (snap: AppSnapshot) => void) => {
      const fn = (_: unknown, snap: AppSnapshot) => cb(snap)
      ipcRenderer.on('state:changed', fn)
      return () => ipcRenderer.removeListener('state:changed', fn)
    }
  },
  auth: {
    google: () => invoke('auth:google') as Promise<UserSession>,
    local: (email: string, name: string) =>
      invoke('auth:local', email, name) as Promise<UserSession>,
    signOut: () => invoke('auth:signOut') as Promise<void>,
    saveGoogleConfig: (cfg: GoogleOAuthConfig) =>
      invoke('auth:saveGoogleConfig', cfg) as Promise<void>
  },
  providers: {
    scan: () => invoke('providers:scan') as Promise<ProviderInfo[]>,
    setEnabled: (id: EngineId, enabled: boolean) =>
      invoke('providers:setEnabled', id, enabled) as Promise<void>,
    setModel: (id: EngineId, modelId: string, enabled: boolean) =>
      invoke('providers:setModel', id, modelId, enabled) as Promise<void>
  },
  workspaces: {
    create: (input: { title: string; cwd: string; layout: LayoutId; engines: EngineId[] }) =>
      invoke('workspaces:create', input) as Promise<Workspace>,
    update: (id: string, patch: Partial<Workspace>) =>
      invoke('workspaces:update', id, patch) as Promise<void>,
    remove: (id: string) => invoke('workspaces:remove', id) as Promise<void>,
    reorder: (ids: string[]) => invoke('workspaces:reorder', ids) as Promise<void>,
    select: (id: string | null) => invoke('workspaces:select', id) as Promise<void>,
    pickFolder: () => invoke('workspaces:pickFolder') as Promise<string | null>,
    openFolder: (id: string) => invoke('workspaces:openFolder', id) as Promise<void>,
    setLayout: (id: string, layout: LayoutId) =>
      invoke('workspaces:setLayout', id, layout) as Promise<void>,
    setPane: (workspaceId: string, paneId: string, patch: PanePatch) =>
      invoke('workspaces:setPane', workspaceId, paneId, patch) as Promise<void>,
    swapPanes: (workspaceId: string, aId: string, bId: string) =>
      invoke('workspaces:swapPanes', workspaceId, aId, bId) as Promise<void>,
    resizePane: (workspaceId: string, paneId: string, edge: ResizeEdge, dx: number, dy: number) =>
      invoke('workspaces:resizePane', workspaceId, paneId, edge, dx, dy) as Promise<void>,
    snapPane: (workspaceId: string, paneId: string, zone: SnapZone) =>
      invoke('workspaces:snapPane', workspaceId, paneId, zone) as Promise<void>
  },
  files: {
    /**
     * Electron File → absolute path (drag-drop).
     * Returns '' on failure; callers MUST surface failures (log/status) — do not drop silently.
     * Threat note: main BrowserWindow uses sandbox:false so preload can call webUtils.getPathForFile
     * and expose absolute filesystem paths to the renderer. Keep contextIsolation:true; never enable
     * nodeIntegration; treat returned paths as sensitive (may reveal user home layout).
     */
    pathFor: (file: File): string => {
      try {
        const p = webUtils.getPathForFile(file)
        if (!p) {
          console.warn('[pqTERM] files.pathFor: empty path for', file?.name)
          return ''
        }
        return p
      } catch (err) {
        const legacy = (file as File & { path?: string }).path
        if (legacy) return legacy
        console.warn('[pqTERM] files.pathFor failed:', file?.name, err)
        return ''
      }
    }
  },
  panes: {
    fill: (input: { engine: string; prompt?: string; skipPaneId?: string }) =>
      invoke('panes:fill', input) as Promise<number[]>
  },
  engines: {
    install: (id: EngineId) => invoke('engines:install', id) as Promise<{ ok: boolean; message: string }>
  },
  terminals: {
    spawn: (input: {
      paneId: string
      workspaceId: string
      engine: EngineId
      model?: string
      cols?: number
      rows?: number
    }) =>
      invoke('term:spawn', input) as Promise<{
        id: string
        replay: string
        replaySeq: number
        existed?: boolean
        replayCols?: number
        replayRows?: number
      }>,
    write: (paneId: string, data: string) => ipcRenderer.send('term:write', paneId, data),
    resize: (paneId: string, cols: number, rows: number) =>
      ipcRenderer.send('term:resize', paneId, cols, rows),
    kill: (paneId: string) => invoke('term:kill', paneId) as Promise<void>,
    clipboardRead: () => invoke('term:clipboardRead') as Promise<string>,
    clipboardReadImage: () => invoke('term:clipboardReadImage') as Promise<string>,
    clipboardWrite: (text: string) => invoke('term:clipboardWrite', text) as Promise<void>,
    clearPane: (workspaceId: string, paneId: string) =>
      invoke('term:clearPane', workspaceId, paneId) as Promise<void>,
    onData: (cb: (paneId: string, data: string, seq: number) => void) => {
      const fn = (_: unknown, paneId: string, data: string, seq: number) => cb(paneId, data, seq)
      ipcRenderer.on('term:data', fn)
      return () => ipcRenderer.removeListener('term:data', fn)
    },
    onExit: (cb: (paneId: string, code: number) => void) => {
      const fn = (_: unknown, paneId: string, code: number) => cb(paneId, code)
      ipcRenderer.on('term:exit', fn)
      return () => ipcRenderer.removeListener('term:exit', fn)
    }
  }
}

contextBridge.exposeInMainWorld('pq', pq)

export type PqAPI = typeof pq
