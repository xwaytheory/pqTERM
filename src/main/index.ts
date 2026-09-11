import { app, BrowserWindow, dialog, ipcMain, shell } from './host'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { productName, runningDev } from './env'
import type {
  AppSnapshot,
  EngineId,
  GoogleOAuthConfig,
  LayoutId,
  Workspace
} from '../shared/types'
import { paneCount } from '../shared/types'
import { loadState, saveState, touchWorkspace } from './store'
import { applyEmailMatch, scanProviders } from './providers'
import { signInWithGoogle, openGoogleConsole } from './auth'
import { PtyManager } from './pty-manager'
import { specById } from './engines'
import { EngineSync } from './sync'
import { BoardHub } from './board'

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
const ptys = new PtyManager(() => mainWindow, {
  extraEnv: (paneId) => board.extraEnv(paneId),
  onOutput: (paneId, data) => board.onOutput(paneId, data),
  onExit: (paneId) => board.paneEnd(paneId)
})
const syncer = new EngineSync(() => mainWindow)

function attachBoard(): void {
  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
  if (ws?.cwd) board.attach(ws.cwd)
  else board.detach()
}

function persist(): void {
  saveState(state)
  mainWindow?.webContents.send('state:changed', state)
}

function newId(): string {
  return crypto.randomUUID()
}

function emptyPanes(layout: LayoutId, engines: EngineId[] = []): Workspace['panes'] {
  const n = paneCount(layout)
  return Array.from({ length: n }, (_, i) => {
    const engine = engines[i] ?? null
    return {
      id: newId(),
      engine,
      title: engine ? specById(engine).name : `pane ${i + 1}`
    }
  })
}

function createWindow(): void {
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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
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
    if (state.activeWorkspaceId && state.activeWorkspaceId !== id) {
      ptys.killWorkspace(state.activeWorkspaceId)
    }
    state.activeWorkspaceId = id
    persist()
    attachBoard()
  })

  ipcMain.handle(
    'workspaces:setPane',
    (
      _e,
      workspaceId: string,
      paneId: string,
      patch: { engine: EngineId | null; model?: string; title?: string }
    ) => {
      state.workspaces = state.workspaces.map((w) => {
        if (w.id !== workspaceId) return w
        return touchWorkspace({
          ...w,
          panes: w.panes.map((p) => {
            if (p.id !== paneId) return p
            const engine = patch.engine
            const title =
              patch.title ??
              (engine ? specById(engine).name : 'idle')
            return { ...p, engine, model: patch.model, title }
          })
        })
      })
      persist()
    }
  )

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
    state.workspaces = state.workspaces.map((w) =>
      w.id === id ? touchWorkspace({ ...w, layout, panes }) : w
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
      const provider = state.providers.find((p) => p.id === input.engine)
      const spec = specById(input.engine)
      const model = input.model
      const extraArgs = [
        ...(spec.args ?? []),
        ...(input.model && spec.modelFlag ? spec.modelFlag(input.model) : [])
      ]
      mainWindow?.webContents.send(
        'term:data',
        input.paneId,
        `\x1b[90m[pq] sync ${input.engine}…\x1b[0m\r\n`
      )
      await syncer.ensure(input.engine)
      mainWindow?.webContents.send(
        'term:data',
        input.paneId,
        `\x1b[90m[pq] spawn ${input.engine}\x1b[0m\r\n`
      )
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
          panes: w.panes.map((p) =>
            p.id === input.paneId
              ? {
                  ...p,
                  engine: input.engine,
                  title: spec.name,
                  model
                }
              : p
          )
        })
      })
      persist()
      board.paneStart(input.paneId, input.engine, spec.name)
      return { id: input.paneId }
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
          p.id === paneId ? { ...p, engine: null, title: 'idle', model: undefined } : p
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
}

app.whenReady().then(() => {
  app.setName('pq')
  app.setAppUserModelId('pq.app')
  state = loadState()
  state.providers = scanProviders(state.user?.email, state.providers)
  saveState(state)
  registerIpc()
  createWindow()
  board.setListener((snap) => mainWindow?.webContents.send('board:changed', snap))
  attachBoard()
  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
  const priority = (ws?.panes.map((p) => p.engine).filter((id): id is EngineId => Boolean(id)) ??
    []) as EngineId[]
  void syncer.start(priority).then(() => {
    state.providers = scanProviders(state.user?.email, state.providers)
    saveState(state)
    mainWindow?.webContents.send('state:changed', state)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptys.killAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => ptys.killAll())
