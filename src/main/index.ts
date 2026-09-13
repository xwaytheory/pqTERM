import { app, BrowserWindow, dialog, ipcMain, session, shell } from './host'
import { join } from 'path'
import { homedir } from 'os'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { productName, runningDev } from './env'
import type {
  AppSnapshot,
  EngineId,
  GoogleOAuthConfig,
  LayoutId,
  PanePatch,
  PaneState,
  Workspace
} from '../shared/types'
import { ENGINE_ORDER, looksLikePathTitle, paneCount } from '../shared/types'
import { loadState, saveState, touchWorkspace } from './store'
import { applyEmailMatch, scanProviders } from './providers'
import { signInWithGoogle, openGoogleConsole } from './auth'
import { PtyManager } from './pty-manager'
import { ENGINE_SPECS, specById } from './engines'
import { EngineSync } from './sync'
import { BoardHub } from './board'
import { UsageHub } from './usage'
import { PaneBridge } from './bridge'
import { RemoteHub, type RemoteCommand } from './remote'
import { pickResume, primeResume, resumeFlag } from './resume'
import { shutdownVoiceHost } from './voice-host'

app.setName('pq')
process.title = 'pq'
app.setAppUserModelId('pq.app')
app.setPath('userData', join(app.getPath('appData'), runningDev() ? 'pq-dev' : 'pq'))

process.on('uncaughtException', (err) => {
  const msg = (err?.message ? String(err.message) : String(err)).replace(/electron/gi, 'pq')
  if (/pty that has already exited|Cannot resize a pty|AttachConsole failed/i.test(msg)) {
    return
  }
  console.error('[pq]', msg)
})
process.on('unhandledRejection', (reason) => {
  const msg = (reason instanceof Error ? reason.message : String(reason)).replace(/electron/gi, 'pq')
  if (/pty that has already exited|Cannot resize a pty|AttachConsole failed/i.test(msg)) {
    return
  }
  console.error('[pq]', msg)
})

let mainWindow: BrowserWindow | null = null
let state: AppSnapshot = {
  user: null,
  google: { clientId: '', clientSecret: '' },
  workspaces: [],
  activeWorkspaceId: null,
  providers: [],
  sidebarOpen: true
}
const board = new BoardHub()
let bridge: PaneBridge
let remote: RemoteHub
const ptys = new PtyManager(() => mainWindow, {
  extraEnv: (paneId) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
    const slot = (ws?.panes.findIndex((p) => p.id === paneId) ?? -1) + 1
    return {
      ...board.extraEnv(paneId),
      ...(bridge ? bridge.envFor(paneId, slot) : {})
    }
  },
  onOutput: (paneId, data) => {
    board.onOutput(paneId, data)
    remote?.pushTerm(paneId, data)
  },
  onExit: (paneId) => {
    board.paneEnd(paneId)
    remote?.pushExit(paneId, 0)
  }
})
const syncer = new EngineSync(() => mainWindow)
const usage = new UsageHub()

function sessionsDir(): string {
  return join(app.getPath('userData'), 'sessions')
}

function sessionLogPath(workspaceId: string, paneId: string): string {
  return join(sessionsDir(), workspaceId, `${paneId}.log`)
}

function restoreSession(ws: Workspace, pane: PaneState): void {
  if (!pane.engine) return
  let seed = ''
  try {
    const f = sessionLogPath(ws.id, pane.id)
    if (existsSync(f)) seed = readFileSync(f, 'utf8')
  } catch {
    seed = ''
  }
  const provider = state.providers.find((p) => p.id === pane.engine)
  const spec = specById(pane.engine)
  let extraArgs = [
    ...(spec.args ?? []),
    ...(pane.model && spec.modelFlag ? spec.modelFlag(pane.model) : [])
  ]
  const session = pickResume(ws.id, pane.engine, pane.sessionHandle)
  if (session) {
    const flag = resumeFlag(pane.engine, session.handle)
    if (flag) extraArgs = [...extraArgs, ...flag]
    if (pane.sessionHandle !== session.handle) pane.sessionHandle = session.handle
  } else if (pane.sessionHandle) {
    // stale/duplicated handle — let the pane pick its session again next boot
    pane.sessionHandle = undefined
  }
  ptys.spawn({
    paneId: pane.id,
    workspaceId: ws.id,
    engine: pane.engine,
    cwd: ws.cwd,
    cols: 80,
    rows: 24,
    resolvedPath: provider?.resolvedPath,
    extraArgs,
    seedBuf: seed
  })
  if (ws.id === state.activeWorkspaceId) {
    board.paneStart(pane.id, pane.engine, pane.title || spec.name)
  }
}

function restoreSessions(): void {
  for (const w of state.workspaces) {
    for (const p of w.panes) restoreSession(w, p)
  }
  persist()
}

function persistSessions(): void {
  const root = sessionsDir()
  const keep = new Set<string>()
  try {
    for (const w of state.workspaces) {
      for (const p of w.panes) {
        if (!p.engine) continue
        const b = ptys.buffer(p.id)
        if (!b.data) continue
        const f = sessionLogPath(w.id, p.id)
        keep.add(f)
        mkdirSync(join(root, w.id), { recursive: true })
        writeFileSync(f, b.data, 'utf8')
      }
    }
    if (existsSync(root)) {
      for (const wsDir of readdirSync(root)) {
        const dir = join(root, wsDir)
        let entries: string[] = []
        try {
          entries = readdirSync(dir)
        } catch {
          continue
        }
        for (const f of entries) {
          const full = join(dir, f)
          if (!keep.has(full)) {
            try {
              unlinkSync(full)
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitAlive(paneId: string, ms = 14000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (ptys.alive(paneId)) return true
    await sleep(150)
  }
  return ptys.alive(paneId)
}

function parseEngine(raw: string): EngineId | null {
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if ((ENGINE_ORDER as string[]).includes(raw.trim().toLowerCase())) {
    return raw.trim().toLowerCase() as EngineId
  }
  const hit = ENGINE_SPECS.find(
    (e) => e.id === s || e.name.toLowerCase().replace(/[\s_-]+/g, '') === s
  )
  return hit?.id ?? null
}

function activeWs() {
  return state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null
}

async function fillPanes(engineRaw: string, prompt: string, skipSlot: number): Promise<number[]> {
  const ws = activeWs()
  const engine = parseEngine(engineRaw)
  if (!ws || !engine) return []
  const spec = specById(engine)
  const targets = ws.panes
    .map((p, i) => ({ p, slot: i + 1 }))
    .filter((t) => t.slot !== skipSlot && !t.p.engine)
  if (targets.length) {
    state.workspaces = state.workspaces.map((w) => {
      if (w.id !== ws.id) return w
      const ids = new Set(targets.map((t) => t.p.id))
      return touchWorkspace({
        ...w,
        panes: w.panes.map((p) =>
          ids.has(p.id) ? { ...p, engine, title: spec.name, titleLocked: false } : p
        )
      })
    })
    persist()
  }
  const spawned: number[] = []
  await Promise.all(
    targets.map(async (t) => {
      if (await waitAlive(t.p.id)) spawned.push(t.slot)
    })
  )
  spawned.sort((a, b) => a - b)
  if (prompt.trim()) {
    if (spawned.length) await sleep(2500)
    const fresh = activeWs()
    const payload = /[\r\n]$/.test(prompt) ? prompt : `${prompt}\r`
    for (const p of fresh?.panes ?? []) {
      if (skipSlot && fresh!.panes[skipSlot - 1]?.id === p.id) continue
      if (p.engine !== engine) continue
      if (!ptys.alive(p.id)) await waitAlive(p.id, 4000)
      ptys.write(p.id, payload)
    }
  }
  return spawned
}

bridge = new PaneBridge({
  list: () => {
    const ws = activeWs()
    if (!ws) return []
    return ws.panes.map((p, i) => ({
      slot: i + 1,
      paneId: p.id,
      engine: p.engine,
      title: p.title
    }))
  },
  spawn: async (slot, engineRaw) => {
    const ws = activeWs()
    const engine = parseEngine(engineRaw)
    if (!ws || !engine) return null
    const pane = ws.panes[slot - 1]
    if (!pane) return null
    const spec = specById(engine)
    state.workspaces = state.workspaces.map((w) => {
      if (w.id !== ws.id) return w
      return touchWorkspace({
        ...w,
        panes: w.panes.map((p) =>
          p.id === pane.id ? { ...p, engine, title: spec.name, titleLocked: false } : p
        )
      })
    })
    persist()
    await waitAlive(pane.id)
    return pane.id
  },
  write: async (slot, text) => {
    const ws = activeWs()
    const pane = ws?.panes[slot - 1]
    if (!pane?.engine) return false
    if (!ptys.alive(pane.id)) await waitAlive(pane.id)
    await sleep(400)
    const payload = /[\r\n]$/.test(text) ? text : `${text}\r`
    ptys.write(pane.id, payload)
    return true
  },
  fill: fillPanes
})
bridge.start()

async function dispatchRemote(cmd: RemoteCommand): Promise<unknown> {
  const a = cmd.a || []
  switch (cmd.m) {
    case 'state':
      return { ...state, google: { clientId: '', clientSecret: '' } }
    case 'workspaces.select': {
      const id = (a[0] as string | null) ?? null
      state.activeWorkspaceId = id
      persist()
      attachBoard()
      return id
    }
    case 'workspaces.remove': {
      const id = String(a[0])
      ptys.killWorkspace(id)
      state.workspaces = state.workspaces.filter((w) => w.id !== id)
      if (state.activeWorkspaceId === id) {
        state.activeWorkspaceId = state.workspaces[0]?.id ?? null
      }
      persist()
      attachBoard()
      return true
    }
    case 'workspaces.create': {
      const input = a[0] as {
        title: string
        cwd: string
        layout: LayoutId
        engines: EngineId[]
      }
      const enabled = new Set(state.providers.filter((p) => p.enabled).map((p) => p.id))
      const engines = (input.engines || []).filter((e) => enabled.has(e) || e === 'shell')
      const ws: Workspace = {
        id: newId(),
        title: input.title.trim() || 'untitled',
        cwd: input.cwd.trim() || homedir(),
        layout: input.layout,
        panes: emptyPanes(input.layout, engines),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      state.workspaces = [ws, ...state.workspaces]
      state.activeWorkspaceId = ws.id
      persist()
      attachBoard()
      return ws
    }
    case 'workspaces.setPane': {
      const workspaceId = String(a[0])
      const paneId = String(a[1])
      const patch = a[2] as PanePatch
      state.workspaces = state.workspaces.map((w) => {
        if (w.id !== workspaceId) return w
        return touchWorkspace({
          ...w,
          panes: w.panes.map((p) => {
            if (p.id !== paneId) return p
            const engine = patch.engine !== undefined ? patch.engine : p.engine
            const titleLocked = patch.titleLocked !== undefined ? patch.titleLocked : p.titleLocked
            let title = p.title
            if (patch.title !== undefined) title = patch.title
            else if (patch.engine !== undefined && !p.titleLocked) {
              title = engine ? specById(engine).name : 'idle'
            }
            return {
              ...p,
              engine,
              model: patch.model !== undefined ? patch.model : p.model,
              title,
              titleLocked
            }
          })
        })
      })
      persist()
      return true
    }
    case 'term.write':
      ptys.write(String(a[0]), String(a[1] ?? ''))
      return true
    case 'term.clear': {
      const workspaceId = String(a[0])
      const paneId = String(a[1])
      ptys.kill(paneId)
      state.workspaces = state.workspaces.map((w) => {
        if (w.id !== workspaceId) return w
        return touchWorkspace({
          ...w,
          panes: w.panes.map((p) =>
            p.id === paneId
              ? { ...p, engine: null, title: 'idle', titleLocked: false, model: undefined }
              : p
          )
        })
      })
      persist()
      board.paneEnd(paneId)
      return true
    }
    case 'panes.fill': {
      const input = (a[0] || {}) as { engine: string; prompt?: string; skipPaneId?: string }
      const ws = activeWs()
      const skip = input.skipPaneId
        ? (ws?.panes.findIndex((p) => p.id === input.skipPaneId) ?? -1) + 1
        : 0
      return fillPanes(input.engine, input.prompt ?? '', skip)
    }
    default:
      throw new Error(`unknown ${cmd.m}`)
  }
}

const userDataDir = join(app.getPath('appData'), runningDev() ? 'pq-dev' : 'pq')
remote = new RemoteHub({
  rootDir: join(__dirname, '..', '..'),
  persistFile: join(userDataDir, 'remote.json'),
  binDir: join(userDataDir, 'bin'),
  snapshot: () => state,
  dispatch: dispatchRemote
})

function attachBoard(): void {
  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
  if (ws?.cwd) {
    board.detach()
    board.attach(ws.cwd)
    for (const p of ws.panes) {
      if (p.engine && ptys.alive(p.id)) {
        board.paneStart(p.id, p.engine, p.title || specById(p.engine).name)
      }
    }
  } else {
    board.detach()
  }
}

function persist(): void {
  saveState(state)
  mainWindow?.webContents.send('state:changed', state)
  remote?.pushState()
}

function newId(): string {
  return crypto.randomUUID()
}

function emptyPanes(layout: LayoutId, engines: EngineId[] = []): Workspace['panes'] {
  const n = paneCount(layout)
  return Array.from({ length: n }, (_, i) => {
    const engine = engines.length ? engines[i % engines.length] : null
    return {
      id: newId(),
      engine,
      title: engine ? specById(engine).name : `pane ${i + 1}`
    }
  })
}

function brandIconPath(): string | undefined {
  const candidates = [
    join(process.resourcesPath || '', 'brand', 'pq.ico'),
    join(__dirname, '../../resources/brand/pq.ico'),
    join(app.getAppPath(), 'resources/brand/pq.ico')
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return undefined
}

function createWindow(): void {
  const icon = brandIconPath()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    backgroundColor: '#07080a',
    autoHideMenuBar: true,
    title: 'pq',
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Threat note: sandbox:false is required so preload can use webUtils.getPathForFile
      // for DnD absolute paths. Mitigations: contextIsolation:true, nodeIntegration:false,
      // no remote module; do not widen privileges further. Paths exposed to renderer are sensitive.
      sandbox: false
    }
  })

  const reveal = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
  }
  mainWindow.setTitle('pq')
  mainWindow.on('ready-to-show', reveal)
  mainWindow.webContents.on('did-finish-load', reveal)
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[pq] load fail', code, desc, url)
    reveal()
  })
  setTimeout(reveal, 2500)
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    const html = join(__dirname, '../renderer/index.html')
    if (existsSync(html)) {
      void mainWindow.loadFile(html)
    } else {
      void mainWindow.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<html><body style="background:#07080a;color:#39ffb6;font-family:Consolas,monospace;padding:40px">
             <h1>pq</h1><p>brak zbudowanego UI (out/renderer).</p>
             <p>odpal <b>pq-dev</b> albo w katalogu projektu: npm run build</p>
             </body></html>`
          )
      )
    }
  }
}

function registerIpc(): void {
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:info', () => ({
    mode: productName() === 'pq-dev' ? 'dev' : 'prod',
    name: productName()
  }))
  ipcMain.handle('app:toggleSidebar', () => {
    state.sidebarOpen = !state.sidebarOpen
    persist()
  })
  ipcMain.handle('state:load', () => state)

  ipcMain.handle('auth:saveGoogleConfig', (_e, cfg: GoogleOAuthConfig) => {
    state.google = {
      clientId: cfg.clientId?.trim() ?? '',
      clientSecret: cfg.clientSecret?.trim() ?? ''
    }
    persist()
  })

  ipcMain.handle('auth:google', async () => {
    const user = await signInWithGoogle(state.google.clientId, state.google.clientSecret, mainWindow)
    state.user = user
    state.providers = applyEmailMatch(
      scanProviders(user.email, state.providers),
      user.email
    )
    persist()
    restoreSessions()
    return user
  })

  ipcMain.handle('auth:local', (_e, email: string, name: string) => {
    const em = email.trim().toLowerCase()
    if (!em.includes('@')) throw new Error('podaj adres e-mail (gmail)')
    const user = {
      email: em,
      name: name.trim() || em.split('@')[0],
      provider: 'local' as const,
      signedInAt: Date.now()
    }
    state.user = user
    state.providers = applyEmailMatch(scanProviders(user.email, state.providers), user.email)
    persist()
    restoreSessions()
    return user
  })

  ipcMain.handle('auth:signOut', () => {
    ptys.killAll()
    state.user = null
    persist()
  })

  ipcMain.handle('providers:scan', () => {
    state.providers = scanProviders(state.user?.email, state.providers)
    persist()
    return state.providers
  })

  ipcMain.handle('providers:setEnabled', (_e, id: EngineId, enabled: boolean) => {
    state.providers = state.providers.map((p) => (p.id === id ? { ...p, enabled } : p))
    persist()
  })

  ipcMain.handle('providers:setModel', (_e, id: EngineId, modelId: string, enabled: boolean) => {
    state.providers = state.providers.map((p) =>
      p.id === id
        ? { ...p, models: p.models.map((m) => (m.id === modelId ? { ...m, enabled } : m)) }
        : p
    )
    persist()
  })

  ipcMain.handle('workspaces:pickFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'katalog workspace',
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle(
    'workspaces:create',
    (
      _e,
      input: { title: string; cwd: string; layout: LayoutId; engines: EngineId[] }
    ) => {
      const title = input.title.trim() || 'untitled'
      const cwd = input.cwd.trim() || homedir()
      const enabled = new Set(state.providers.filter((p) => p.enabled).map((p) => p.id))
      const engines = (input.engines || []).filter((e) => enabled.has(e) || e === 'shell')
      const ws: Workspace = {
        id: newId(),
        title,
        cwd,
        layout: input.layout,
        panes: emptyPanes(input.layout, engines),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      state.workspaces = [ws, ...state.workspaces]
      state.activeWorkspaceId = ws.id
      persist()
      attachBoard()
      return ws
    }
  )

  ipcMain.handle('workspaces:update', (_e, id: string, patch: Partial<Workspace>) => {
    state.workspaces = state.workspaces.map((w) =>
      w.id === id ? touchWorkspace({ ...w, ...patch, id: w.id }) : w
    )
    persist()
  })

  ipcMain.handle('workspaces:remove', (_e, id: string) => {
    ptys.killWorkspace(id)
    state.workspaces = state.workspaces.filter((w) => w.id !== id)
    if (state.activeWorkspaceId === id) {
      state.activeWorkspaceId = state.workspaces[0]?.id ?? null
    }
    persist()
    attachBoard()
  })

  ipcMain.handle('workspaces:select', (_e, id: string | null) => {
    state.activeWorkspaceId = id
    persist()
    attachBoard()
  })

  ipcMain.handle('workspaces:setPane', (_e, workspaceId: string, paneId: string, patch: PanePatch) => {
    state.workspaces = state.workspaces.map((w) => {
      if (w.id !== workspaceId) return w
      return touchWorkspace({
        ...w,
        panes: w.panes.map((p) => {
          if (p.id !== paneId) return p
          const engine = patch.engine !== undefined ? patch.engine : p.engine
          const titleLocked = patch.titleLocked !== undefined ? patch.titleLocked : p.titleLocked
          let title = p.title
          if (patch.title !== undefined) {
            title = patch.title
          } else if (patch.engine !== undefined && !p.titleLocked) {
            title = engine ? specById(engine).name : 'idle'
          }
          if (patch.title !== undefined) board.paneTitle(paneId, title)
          return {
            ...p,
            engine,
            model: patch.model !== undefined ? patch.model : p.model,
            title,
            titleLocked
          }
        })
      })
    })
    persist()
  })

  ipcMain.handle('workspaces:setLayout', (_e, id: string, layout: LayoutId) => {
    const ws = state.workspaces.find((w) => w.id === id)
    if (!ws) return
    const n = paneCount(layout)
    let panes = [...ws.panes]
    if (panes.length > n) {
      const dropped = panes.slice(n)
      dropped.forEach((p) => ptys.kill(p.id))
      panes = panes.slice(0, n)
    } else {
      while (panes.length < n) {
        panes.push({ id: newId(), engine: null, title: `pane ${panes.length + 1}` })
      }
    }
    const zoomedPaneId = panes.some((p) => p.id === ws.zoomedPaneId) ? ws.zoomedPaneId : null
    state.workspaces = state.workspaces.map((w) =>
      w.id === id ? touchWorkspace({ ...w, layout, panes, zoomedPaneId }) : w
    )
    persist()
  })

  ipcMain.handle(
    'term:spawn',
    async (
      _e,
      input: {
        paneId: string
        workspaceId: string
        engine: EngineId
        model?: string
        cols?: number
        rows?: number
      }
    ) => {
      const ws = state.workspaces.find((w) => w.id === input.workspaceId)
      if (!ws) throw new Error('brak workspace')
      const spec = specById(input.engine)
      const provider = state.providers.find((p) => p.id === input.engine)
      const model = input.model

      const existing = ptys.describe(input.paneId)
      if (
        existing?.alive &&
        existing.engine === input.engine &&
        existing.workspaceId === input.workspaceId
      ) {
        // session already running — keep it alive and let the renderer replay its buffer
        const title = ws.panes.find((p) => p.id === input.paneId)?.title
        if (input.workspaceId === state.activeWorkspaceId) {
          board.paneStart(input.paneId, input.engine, title || spec.name)
        }
        const b = ptys.buffer(input.paneId)
        return { id: input.paneId, replay: b.data, replaySeq: b.seq, existed: true }
      }

      const extraArgs = [
        ...(spec.args ?? []),
        ...(input.model && spec.modelFlag ? spec.modelFlag(input.model) : [])
      ]
      const paneInWs = ws.panes.find((p) => p.id === input.paneId)
      let resumeHandle = paneInWs?.sessionHandle
      const session = pickResume(input.workspaceId, input.engine, paneInWs?.sessionHandle)
      if (session) {
        const flag = resumeFlag(input.engine, session.handle)
        if (flag) extraArgs.push(...flag)
        resumeHandle = session.handle
      }
      ptys.spawn({
        paneId: input.paneId,
        workspaceId: input.workspaceId,
        engine: input.engine,
        cwd: ws.cwd,
        cols: input.cols || 80,
        rows: input.rows || 24,
        resolvedPath: provider?.resolvedPath,
        extraArgs
      })
      state.workspaces = state.workspaces.map((w) => {
        if (w.id !== input.workspaceId) return w
        return touchWorkspace({
          ...w,
          panes: w.panes.map((p) => {
            if (p.id !== input.paneId) return p
            const keep =
              p.titleLocked && p.title.trim() && !looksLikePathTitle(p.title) ? p.title : spec.name
            return {
              ...p,
              engine: input.engine,
              title: keep,
              model,
              sessionHandle: resumeHandle
            }
          })
        })
      })
      persist()
      if (input.workspaceId === state.activeWorkspaceId) {
        const live = state.workspaces
          .find((w) => w.id === input.workspaceId)
          ?.panes.find((p) => p.id === input.paneId)
        board.paneStart(input.paneId, input.engine, live?.title || spec.name)
      }
      return { id: input.paneId, replay: '', replaySeq: 0, existed: false }
    }
  )

  ipcMain.on('term:write', (_e, paneId: string, data: string) => {
    ptys.write(paneId, data)
  })
  ipcMain.on('term:resize', (_e, paneId: string, cols: number, rows: number) => {
    ptys.resize(paneId, cols, rows)
  })
  ipcMain.handle('term:kill', (_e, paneId: string) => {
    ptys.kill(paneId)
  })
  ipcMain.handle('term:clearPane', (_e, workspaceId: string, paneId: string) => {
    ptys.kill(paneId)
    state.workspaces = state.workspaces.map((w) => {
      if (w.id !== workspaceId) return w
      return touchWorkspace({
        ...w,
        panes: w.panes.map((p) =>
          p.id === paneId
            ? {
                ...p,
                engine: null,
                title: 'idle',
                titleLocked: false,
                model: undefined,
                sessionHandle: undefined
              }
            : p
        )
      })
    })
    persist()
    board.paneEnd(paneId)
  })

  ipcMain.handle('open:google-console', () => openGoogleConsole())
  ipcMain.handle('board:get', () => board.snapshot())
  ipcMain.handle('sync:start', () => syncer.start())
  ipcMain.handle('sync:last', () => syncer.last)
  ipcMain.handle('usage:get', () => usage.snapshot())
  ipcMain.handle('remote:info', () => remote.info())
  ipcMain.handle('remote:start', () => remote.start())
  ipcMain.handle('remote:stop', () => remote.stop(true))
  ipcMain.handle('remote:regenPin', () => remote.regenPin())
  ipcMain.handle(
    'panes:fill',
    async (_e, input: { engine: string; prompt?: string; skipPaneId?: string }) => {
      const ws = activeWs()
      const skip = input.skipPaneId
        ? (ws?.panes.findIndex((p) => p.id === input.skipPaneId) ?? -1) + 1
        : 0
      return fillPanes(input.engine, input.prompt ?? '', skip)
    }
  )
}

app.whenReady().then(async () => {
  app.setName('pq')
  app.setAppUserModelId('pq.app')
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  // cross-origin isolation enables onnxruntime-web threads (dramatically faster STT),
  // with COEP:credentialless so HF model downloads keep working
  if (runningDev()) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(details.url)) {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Cross-Origin-Opener-Policy': ['same-origin'],
            'Cross-Origin-Embedder-Policy': ['credentialless']
          }
        })
        return
      }
      callback({})
    })
  }
  state = loadState()
  state.providers = scanProviders(state.user?.email, state.providers)
  saveState(state)
  registerIpc()
  board.setListener((snap) => mainWindow?.webContents.send('board:changed', snap))
  usage.onChange((m) => mainWindow?.webContents.send('usage:changed', m))
  attachBoard()
  // Scan engine session storage BEFORE any TUI starts (the opencode CLI becomes very
  // slow under contention with running opencode servers) so every pane can resume
  // its previous conversation right away.
  try {
    await primeResume(state.workspaces, state.providers)
  } catch (err) {
    console.error('[pq]', err instanceof Error ? err.message : String(err))
  }
  restoreSessions()
  createWindow()
  usage.start()
  void remote.restore().catch((err) => console.error('[pq] remote', err))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  persistSessions()
  ptys.killAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  usage.stop()
  bridge.stop()
  remote.stop()
  persistSessions()
  ptys.killAll()
  // No-op when voice-host was never spawned (production default unchanged).
  // Does not auto-spawn. Cancel-over-IPC is best-effort TODO — see voice-host.ts.
  shutdownVoiceHost()
})

// ---------------------------------------------------------------------------
// Overnight opt-in sketch — NOT called from app.whenReady / UI.
// Default OFF. Enable only via PQ_VOICE_HOST=1 or spawnVoiceHost({ enabled:true }).
// before-quit calls shutdownVoiceHost() — no-op when never spawned.
// See src/main/voice-host.ts + docs/VOICE-HOST-BRIDGE.md
// ---------------------------------------------------------------------------
export {
  spawnVoiceHost,
  stopVoiceHost,
  shutdownVoiceHost,
  getActiveVoiceHost,
  resolveVoiceExe,
  isVoiceHostEnvEnabled,
  isVoiceHostEnabled
} from './voice-host'
