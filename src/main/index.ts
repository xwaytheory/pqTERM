import { execFile, spawn } from 'child_process'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, session, shell } from './host'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { dirname, join, relative } from 'path'
import { homedir, tmpdir } from 'os'
import { stat } from 'fs/promises'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  chmodSync
} from 'fs'
import { productName, runningDev, editionId, buildNumber, profileDirName } from './env'
import type {
  AppSnapshot,
  EngineAction,
  EngineId,
  GoogleOAuthConfig,
  LayoutId,
  NotificationSettings,
  PanePatch,
  PaneState,
  Workspace
} from '../shared/types'
import {
  ACTIVITY_LABELS,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_UI,
  ENGINE_ORDER,
  isRawShell,
  MAX_PANES,
  paneCount,
  sanitizeUi,
  UI_ZOOM_MAX,
  UI_ZOOM_MIN,
  type SnapZone,
  type UiSettings
} from '../shared/types'
import {
  applyAreasToPanes,
  defaultAreas,
  resolveAreas,
  resizePanes,
  RESIZE_EDGES,
  type ResizeEdge,
  snapAreas
} from '../shared/grid'
import { reorderByIds } from '../shared/order'
import { isHttpUrl } from '../shared/httpUrl'
import { loadState, saveState, touchWorkspace } from './store'
import { trustWorkspace } from './trust'
import { applyEmailMatch, scanProviders } from './providers'
import { signInWithGoogle, openGoogleConsole } from './auth'
import { PtyManager } from './pty-manager'
import { PaneActivityTracker } from './pane-activity'
import { ENGINE_SPECS, specById } from './engines'
import { EngineSync } from './sync'
import { elevateArgs, lifecycleScript } from './install-scripts'
import { BoardHub } from './board'
import { UsageHub } from './usage'
import { PaneBridge } from './bridge'
import { RemoteHub, type RemoteCommand } from './remote'
import { pickResume, primeResume, resumeFlag, shouldClearHandle } from './resume'
import { checkpointRoot, mintSessionId, writeCheckpoint } from './ledger'
import { readTranscript } from './session-adapters'
import { handoffSeed } from './handoff'
import { captureCodebuddyHandle } from './handle-capture'
import { shutdownVoiceHost } from './voice-host'
import { adoptAutoTitle, updatePaneTitle } from './pane-title'
import { queryActiveOpenCodeTitle } from './opencode-title'

app.setName('pqTERM')
process.title = 'pqTERM'
app.setAppUserModelId('com.pqterm.app')
app.setPath('userData', join(app.getPath('appData'), profileDirName()))

// Druga instancja tego samego profilu nie może startować (kanon: RemoteHub,
// porty, locki PTY, wspólny pq-state) — podnosi już otwarte okno zamiast kolidować.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindow
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
}

process.on('uncaughtException', (err) => {
  const msg = (err?.message ? String(err.message) : String(err)).replace(/electron/gi, 'pqTERM')
  if (/pty that has already exited|Cannot resize a pty|AttachConsole failed/i.test(msg)) {
    return
  }
  console.error('[pqTERM]', msg)
})
process.on('unhandledRejection', (reason) => {
  const msg = (reason instanceof Error ? reason.message : String(reason)).replace(/electron/gi, 'pqTERM')
  if (/pty that has already exited|Cannot resize a pty|AttachConsole failed/i.test(msg)) {
    return
  }
  console.error('[pqTERM]', msg)
})

let mainWindow: BrowserWindow | null = null
let state: AppSnapshot = {
  user: null,
  google: { clientId: '', clientSecret: '' },
  workspaces: [],
  activeWorkspaceId: null,
  providers: [],
  sidebarOpen: true,
  notifications: { ...DEFAULT_NOTIFICATIONS },
  ui: { ...DEFAULT_UI }
}
const board = new BoardHub()
let bridge: PaneBridge
let remote: RemoteHub
let focusedPaneId: string | null = null
const paneNotifications = new Map<string, Notification>()
let activityTimer: ReturnType<typeof setInterval> | null = null

function paneIsFocused(paneId: string): boolean {
  const ws = activeWs()
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused() &&
    mainWindow.isVisible() && focusedPaneId === paneId &&
    ws?.panes.some((p) => p.id === paneId && p.engine) &&
    (!ws.zoomedPaneId || ws.zoomedPaneId === paneId))
}

function closePaneNotification(paneId: string): void {
  const notification = paneNotifications.get(paneId)
  paneNotifications.delete(paneId)
  notification?.close()
}

/**
 * One desktop toast per pane: shows it, and clicking it switches to the
 * workspace, un-zooms if needed, focuses the pane. Every alert source (BEL,
 * OSC 9/99/777, screen-based guess, process exit) goes through here, so the
 * guards and the click target can never drift apart.
 */
function notifyPane(paneId: string, title: string, body: string): void {
  const win = mainWindow
  const ws = state.workspaces.find((w) => w.panes.some((p) => p.id === paneId && p.engine))
  if (!state.notifications.enabled || paneIsFocused(paneId) || !ws ||
    !win || win.isDestroyed() || win.webContents.isDestroyed() || !Notification.isSupported()) return
  const pane = ws.panes.find((p) => p.id === paneId)!
  closePaneNotification(paneId)
  const notification = new Notification({ title, body, silent: !state.notifications.sound })
  paneNotifications.set(paneId, notification)
  notification.on('click', () => {
    if (paneNotifications.get(paneId) !== notification || mainWindow !== win ||
      win.isDestroyed() || win.webContents.isDestroyed()) return
    const target = state.workspaces.find((w) => w.id === ws.id)
    if (!target?.panes.some((p) => p.id === paneId && p.engine)) return
    state.activeWorkspaceId = target.id
    if (target.zoomedPaneId && target.zoomedPaneId !== paneId) target.zoomedPaneId = null
    focusedPaneId = null
    persist()
    attachBoard()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('activity:focus', target.id, paneId)
    closePaneNotification(paneId)
  })
  const forget = () => {
    if (paneNotifications.get(paneId) === notification) paneNotifications.delete(paneId)
  }
  notification.on('close', forget)
  notification.on('failed', forget)
  notification.show()
}

/** Toast title: workspace + pane, with the CLI's own title when it sent one. */
function paneAlertTitle(paneId: string, cliTitle?: string): string {
  const ws = state.workspaces.find((w) => w.panes.some((p) => p.id === paneId && p.engine))
  const pane = ws?.panes.find((p) => p.id === paneId)
  if (!ws || !pane) return ''
  return cliTitle ? `${ws.title} · ${cliTitle}` : `${ws.title} · ${pane.title}`
}

const activity = new PaneActivityTracker((paneId, next) => {
  if (!next || !next.unread) closePaneNotification(paneId)
  if (next?.unread && paneIsFocused(paneId)) {
    activity.acknowledge(paneId)
    return
  }
  const win = mainWindow
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('activity:changed', paneId, next)
  }
}, (paneId, kind) => {
  notifyPane(paneId, paneAlertTitle(paneId), ACTIVITY_LABELS[kind])
})

/** Model id trafia prosto do argv CLI (modelFlag), więc ma zamknięty kształt;
 *  engine musi istnieć w liście speców. Patch przychodzi z renderera/telefonu. */
const MODEL_RE = /^[\w./:+-]{1,128}$/

function validPanePatch(patch: PanePatch): boolean {
  if (!patch || typeof patch !== 'object') return false
  if (
    patch.engine !== undefined && patch.engine !== null &&
    !(typeof patch.engine === 'string' && ENGINE_SPECS.some((s) => s.id === patch.engine))
  ) return false
  if (
    patch.model !== undefined && patch.model !== null &&
    !(typeof patch.model === 'string' && MODEL_RE.test(patch.model))
  ) return false
  if (patch.title !== undefined && typeof patch.title !== 'string') return false
  return patch.titleLocked === undefined || typeof patch.titleLocked === 'boolean'
}

function ledgerRoot(): string {
  return checkpointRoot(process.env.LOCALAPPDATA || app.getPath('userData'), profileDirName())
}

/** Repo-wide porcelain lines, capped. Never throws — the pane is already dying. */
async function repoChanges(cwd: string): Promise<string[]> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'git',
        ['status', '--porcelain', '--untracked-files=no'],
        { cwd, timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 },
        (err, out) => (err ? reject(err) : resolve(String(out)))
      )
    })
    return stdout
      .split('\n')
      .map((l) => l.trimEnd())
      .filter(Boolean)
      .slice(0, 40)
  } catch {
    return []
  }
}

/**
 * Derive a checkpoint from the engine's own transcript plus repo state.
 * It runs when the pane is already gone, so it never throws and never blocks boot.
 */
async function writePaneCheckpoint(paneId: string): Promise<string | null> {
  const ws = state.workspaces.find((w) => w.panes.some((p) => p.id === paneId))
  const pane = ws?.panes.find((p) => p.id === paneId)
  if (!ws || !pane?.engine || !pane.sessionId) return null
  // No captured handle means we cannot read the conversation at all — an empty
  // checkpoint would look like context and teach the next agent to trust nothing.
  if (!pane.sessionHandle) return null
  const provider = state.providers.find((p) => p.id === pane.engine)
  const transcript = await readTranscript(pane.engine, {
    cwd: ws.cwd,
    handle: pane.sessionHandle,
    target: provider?.resolvedPath
  })
  return writeCheckpoint(ledgerRoot(), {
    sessionId: pane.sessionId,
    engine: pane.engine,
    handle: pane.sessionHandle,
    cwd: ws.cwd,
    transcript,
    changes: await repoChanges(ws.cwd)
  })
}

/**
 * Some CLIs publish their session id only after they start (CodeBuddy writes
 * ~/.codebuddy/sessions/<pid>.json). Poll briefly and bind it, so a later handoff
 * can read that conversation instead of starting blind.
 */
async function captureHandleLater(paneId: string, since = Date.now()): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    const ws = state.workspaces.find((w) => w.panes.some((p) => p.id === paneId))
    const pane = ws?.panes.find((p) => p.id === paneId)
    if (!ws || !pane || pane.engine !== 'codebuddy' || pane.sessionHandle) return
    const pid = ptys.pidOf(paneId)
    if (!pid) return
    const handle = captureCodebuddyHandle(pid, ws.cwd, since - 5000)
    if (!handle) continue
    if (!ptys.alive(paneId)) return
    pane.sessionHandle = handle
    persist()
    return
  }
}

/** Wait until a freshly spawned TUI has painted something, so the seed is not swallowed. */
async function waitForOutput(paneId: string, ms = 12000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (!ptys.alive(paneId)) return false
    if (ptys.buffer(paneId).seq > 0) return true
    await sleep(150)
  }
  return false
}

/**
 * Move one pane's task to another engine in the same cwd.
 * The checkpoint is written *before* the old CLI is killed — that is the last
 * moment its transcript is complete.
 */
async function handoffPane(
  paneId: string,
  engine: EngineId
): Promise<{ ok: boolean; checkpoint: string | null; reason?: string }> {
  const ws = state.workspaces.find((w) => w.panes.some((p) => p.id === paneId))
  const pane = ws?.panes.find((p) => p.id === paneId)
  if (!ws || !pane) return { ok: false, checkpoint: null, reason: 'nie ma takiego pane' }
  const provider = state.providers.find((p) => p.id === engine)
  if (!provider?.installed) return { ok: false, checkpoint: null, reason: 'silnik niezainstalowany' }
  const checkpoint = await writePaneCheckpoint(paneId)
  const sourceEngine = pane.engine
  const spec = specById(engine)
  // ptys.spawn kills the current process itself — no separate kill needed
  ptys.spawn({
    paneId,
    workspaceId: ws.id,
    engine,
    cwd: ws.cwd,
    cols: 80,
    rows: 24,
    resolvedPath: provider.resolvedPath,
    extraArgs: [...(spec.args ?? [])]
  })
  state.workspaces = state.workspaces.map((w) => {
    if (w.id !== ws.id) return w
    return touchWorkspace({
      ...w,
      panes: w.panes.map((p) =>
        p.id === paneId
          ? {
              ...p,
              engine,
              // a handoff is a new conversation: fresh lineage, and the previous
              // engine's handle must never reach this one's resume args
              sessionId: mintSessionId(),
              parentSessionId: p.sessionId,
              sessionHandle: undefined,
              model: undefined,
              title: p.titleLocked ? p.title : spec.name
            }
          : p
      )
    })
  })
  persist()
  void captureHandleLater(paneId)
  if (!checkpoint) {
    return { ok: true, checkpoint, reason: 'brak uchwytu sesji — nowy silnik startuje bez kontekstu' }
  }
  if (!(await waitForOutput(paneId))) {
    return { ok: true, checkpoint, reason: 'checkpoint zapisany, ale CLI nie odpowiedział — wklej seed ręcznie' }
  }
  await sleep(350)
  const seed = handoffSeed({ checkpointPath: checkpoint, sourceEngine, targetEngine: engine })
  ptys.write(paneId, `${seed}\r`)
  return { ok: true, checkpoint }
}

function requireRenderer(event: IpcMainInvokeEvent | IpcMainEvent): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed() ||
    event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Invalid renderer sender')
  }
}
const ptys = new PtyManager(() => mainWindow, {
  extraEnv: (paneId) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
    const slot = (ws?.panes.findIndex((p) => p.id === paneId) ?? -1) + 1
    return {
      ...board.extraEnv(paneId),
      ...(bridge ? bridge.envFor(paneId, slot) : {})
    }
  },
  onStart: (paneId) => {
    const pane = state.workspaces.flatMap((w) => w.panes).find((p) => p.id === paneId)
    const engine = pane?.engine
    activity.start(paneId, { agent: engine ? !isRawShell(engine) : false })
  },
  // Type into a pane and the silence heuristic is armed for it; a pane nobody
  // has asked anything never escalates to "waiting for you" (that was the
  // false alert on freshly spawned, still-empty CLIs).
  onInput: (paneId) => activity.input(paneId),
  onOutput: (paneId, data) => {
    activity.output(paneId, data)
    board.onOutput(paneId, data)
    remote?.pushTerm(paneId, data)
  },
  onExit: (paneId, code, intentional) => {
    activity.exit(paneId, code, intentional)
    board.paneEnd(paneId)
    remote?.pushExit(paneId, code)
    // A crash is the one handoff trigger nobody can forget. Engine switches and
    // quit are intentional — those keep their checkpoints on the manual path.
    if (!intentional) void writePaneCheckpoint(paneId)
  },
  onNotice: (paneId, notice) => {
    // The CLI itself said "notify the user" (OSC 9 / 99 / 777) — trust it over
    // any screen-based guess and show the toast under the same guards as BELs.
    activity.notice(paneId, notice.title, notice.body)
    notifyPane(paneId, paneAlertTitle(paneId, notice.title), notice.body)
  },
  onTitle: (paneId, title) => {
    applyAutoTitle(paneId, title)
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

/** Scrollback seed persisted at quit for a pane's terminal log ('' when absent). */
function sessionSeed(workspaceId: string, paneId: string): { data: string } {
  try {
    const f = sessionLogPath(workspaceId, paneId)
    if (!existsSync(f)) return { data: '' }
    return { data: readFileSync(f, 'utf8') }
  } catch {
    return { data: '' }
  }
}

function restoreSession(ws: Workspace, pane: PaneState): void {
  if (!pane.engine) return
  // Stale engine id (CLI uninstall / lista speców się zmieniła) albo padnięty
  // spawn nie mogą zwalić całego bootu — ten jeden pane staje się idle.
  try {
    const existing = ptys.describe(pane.id)
    if (existing?.alive && existing.engine === pane.engine && existing.workspaceId === ws.id) return
    const seed = sessionSeed(ws.id, pane.id)
    const provider = state.providers.find((p) => p.id === pane.engine)
    const spec = specById(pane.engine)
    const model = pane.model
    let extraArgs = [
      ...(spec.args ?? []),
      ...(model && spec.modelFlag ? spec.modelFlag(model) : [])
    ]
    const session = pickResume(ws.id, pane.engine, pane.id, pane.sessionHandle)
    if (session) {
      const flag = resumeFlag(pane.engine, session.handle)
      if (flag) extraArgs = [...extraArgs, ...flag]
      if (pane.sessionHandle !== session.handle) pane.sessionHandle = session.handle
    } else if (shouldClearHandle(ws.id, pane.engine, pane.sessionHandle)) {
      // the store was read and no longer holds this handle — let the pane pick again next boot
      pane.sessionHandle = undefined
    }
    if (!pane.sessionId) pane.sessionId = mintSessionId()
    ptys.spawn({
      paneId: pane.id,
      workspaceId: ws.id,
      engine: pane.engine,
      cwd: ws.cwd,
      cols: 80,
      rows: 24,
      resolvedPath: provider?.resolvedPath,
      extraArgs,
      seedBuf: seed.data
    })
    void captureHandleLater(pane.id)
    if (ws.id === state.activeWorkspaceId) {
      board.paneStart(pane.id, pane.engine, pane.title || spec.name)
    }
  } catch (err) {
    console.error(
      `[pqTERM] restore ${pane.engine} failed for pane ${pane.id}:`,
      err instanceof Error ? err.message : err
    )
    pane.engine = null
  }
}

function restoreSessions(): void {
  // Lazy boot: spawn only the active workspace's panels; the rest come up on
  // first activation via term:spawn (renderer mounts panes per active workspace).
  // Resume handles + scrollback seeds are picked up on that path identically.
  const active = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
  if (active) for (const p of active.panes) restoreSession(active, p)
  persist()
}

function persistSessions(): void {
  const root = sessionsDir()
  const keep = new Set<string>()
  try {
    for (const w of state.workspaces) {
      for (const p of w.panes) {
        if (!p.engine) continue
        const f = sessionLogPath(w.id, p.id)
        keep.add(f)
        const b = ptys.buffer(p.id)
        if (!b.data) continue
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

async function fillPanes(
  engineRaw: string,
  prompt: string,
  skipSlot: number,
  workspaceId?: string
): Promise<number[]> {
  // capture the target once — active workspace must not hijack mid-flight fills
  const ws = state.workspaces.find((w) => w.id === (workspaceId || state.activeWorkspaceId)) ?? null
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
          ids.has(p.id) ? { ...p, engine, title: p.titleLocked ? p.title : spec.name } : p
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
    const fresh = ws.id === state.activeWorkspaceId ? activeWs() : ws
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
  checkpoint: async (slot) => {
    const ws = activeWs()
    const pane = ws?.panes[slot - 1]
    return pane ? writePaneCheckpoint(pane.id) : null
  },
  handoff: async (slot, engineRaw) => {
    const ws = activeWs()
    const engine = parseEngine(engineRaw)
    const pane = ws?.panes[slot - 1]
    if (!pane) return { ok: false, checkpoint: null, reason: 'nie ma takiego slotu' }
    if (!engine) return { ok: false, checkpoint: null, reason: 'nieznany silnik' }
    return handoffPane(pane.id, engine)
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
          p.id === pane.id ? { ...p, engine, title: p.titleLocked ? p.title : spec.name } : p
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
  fill: fillPanes,
  updaterSource: findUpdateScript(app.getAppPath()) ?? undefined
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
      const engines = (input.engines || []).filter((e) => enabled.has(e) || isRawShell(e))
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
      if (!validPanePatch(patch)) throw new Error('Invalid pane patch')
      state.workspaces = state.workspaces.map((w) => {
        if (w.id !== workspaceId) return w
        return touchWorkspace({
          ...w,
          panes: w.panes.map((p) => {
            if (p.id !== paneId) return p
            const engine = patch.engine ?? p.engine
            return updatePaneTitle(p, patch, engine ? specById(engine).name : 'idle')
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
      return true
    }
    case 'panes.fill': {
      const input = (a[0] || {}) as {
        workspaceId?: string
        engine: string
        prompt?: string
        skipPaneId?: string
      }
      if (typeof input !== 'object' || input === null || typeof input.engine !== 'string') {
        throw new Error('Invalid fill request')
      }
      const ws = input.workspaceId
        ? state.workspaces.find((w) => w.id === input.workspaceId)
        : activeWs()
      if (!ws) throw new Error('Unknown workspace for fill')
      const skip = input.skipPaneId
        ? (ws.panes.findIndex((p) => p.id === input.skipPaneId) ?? -1) + 1
        : 0
      return fillPanes(input.engine, input.prompt ?? '', skip, ws.id)
    }
    default:
      throw new Error(`unknown ${cmd.m}`)
  }
}

const userDataDir = join(app.getPath('appData'), profileDirName())
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

/**
 * OSC titles churn fast (some CLIs update them on every tool call). The in-memory title
 * still changes immediately, but the side effects — board write (a `git status`!) and the
 * full state persist + IPC/WS broadcast — are coalesced to one pass per window.
 */
const TITLE_FLUSH_MS = 400
const pendingTitlePanes = new Set<string>()
let titleFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushTitleSideEffects(): void {
  if (titleFlushTimer) {
    clearTimeout(titleFlushTimer)
    titleFlushTimer = null
  }
  if (!pendingTitlePanes.size) return
  const all = state.workspaces.flatMap((w) => w.panes)
  for (const id of pendingTitlePanes) {
    const pane = all.find((p) => p.id === id)
    if (pane) board.paneTitle(id, pane.title)
  }
  pendingTitlePanes.clear()
  persist()
}

/**
 * The CLI (opencode/omp/…) set their own terminal title via OSC — adopt it as
 * the pane title, unless the user locked a custom one. Only meaningful, non
 * path-looking titles override the engine default name.
 */
function applyAutoTitle(paneId: string, title: string): void {
  let changed = false
  state.workspaces = state.workspaces.map((w) => {
    if (!w.panes.some((p) => p.id === paneId)) return w
    const panes = w.panes.map((p) => {
      if (p.id !== paneId) return p
      if (!p.engine) return p
      const spec = specById(p.engine)
      const next = adoptAutoTitle(p, title, { id: spec.id, name: spec.name, mark: spec.mark }, spec.name)
      if (next === p) return p
      changed = true
      return next
    })
    return changed ? touchWorkspace({ ...w, panes }) : w
  })
  if (!changed) return
  pendingTitlePanes.add(paneId)
  if (!titleFlushTimer) titleFlushTimer = setTimeout(flushTitleSideEffects, TITLE_FLUSH_MS)
}

let lastSerializedState = ''

function persist(): void {
  for (const paneId of Object.keys(activity.get())) {
    if (!state.user || !state.workspaces.some((w) => w.panes.some((p) => p.id === paneId && p.engine))) {
      activity.remove(paneId)
    }
  }
  if (focusedPaneId && !paneIsFocused(focusedPaneId)) focusedPaneId = null
  // Diff-guard: persisting is triggered on many paths (OSC titles coalesced every
  // 400 ms, board flushes, IPC intents) — skip the disk write + IPC/WS broadcast
  // entirely when the serialized snapshot did not actually change.
  const serialized = JSON.stringify(state)
  if (serialized === lastSerializedState) return
  saveState(state)
  lastSerializedState = serialized
  mainWindow?.webContents.send('state:changed', state)
  remote?.pushState()
}

// opencode keeps its session title in its own DB, not in the terminal title: a long session can
// be renamed without any OSC traffic. Poll it per workspace (one process per workspace, never
// one per pane) and feed the result through the same adoption path as the OSC titles.
let titlePoller: ReturnType<typeof setInterval> | null = null
let titlePollBusy = false

function startTitlePoller(): void {
  if (titlePoller) return
  const POLL_MS = 5000
  titlePoller = setInterval(() => {
    if (titlePollBusy) return
    titlePollBusy = true
    const target = state.providers.find((p) => p.id === 'opencode')?.resolvedPath || 'opencode'
    const wsList = state.workspaces.filter((w) =>
      w.panes.some((p) => p.engine === 'opencode' && !p.titleLocked && ptys.alive(p.id))
    )
    if (!wsList.length) {
      titlePollBusy = false
      return
    }
    Promise.all(
      wsList.map(async (ws) => {
        try {
          const title = await queryActiveOpenCodeTitle(ws.cwd, target)
          if (!title) return
          for (const p of ws.panes) {
            if (p.engine === 'opencode' && !p.titleLocked && ptys.alive(p.id)) {
              applyAutoTitle(p.id, title)
            }
          }
        } catch {
          /* the CLI may be absent or the DB locked — keep the last known title */
        }
      })
    ).then(() => {
      titlePollBusy = false
    })
  }, POLL_MS)
}

function stopTitlePoller(): void {
  if (titlePoller) {
    clearInterval(titlePoller)
    titlePoller = null
  }
}

function newId(): string {
  return crypto.randomUUID()
}

function emptyPanes(layout: LayoutId, engines: EngineId[] = []): Workspace['panes'] {
  const n = paneCount(layout)
  const areas = defaultAreas(n)
  return Array.from({ length: n }, (_, i) => {
    const engine = engines.length ? engines[i % engines.length] : null
    return {
      id: newId(),
      engine,
      title: engine ? specById(engine).name : `pane ${i + 1}`,
      area: areas[i]
    }
  })
}

/**
 * Add one idle pane. The new pane has no engine, so it shows the SPAWN ENGINE
 * picker. The grid is re-tiled with `defaultAreas`: splitting the largest cell
 * in place shifted every later pane onto the previous rectangle, and with equal
 * cells that cell is always the first one — the top-left window collapsed and
 * looked deleted. Zoom is dropped so the pane you just asked for is visible.
 * Returns false at MAX_PANES; nothing is added.
 */
function addPane(workspaceId: string): boolean {
  const ws = state.workspaces.find((w) => w.id === workspaceId)
  if (!ws || ws.panes.length >= MAX_PANES) return false
  const panes = [
    ...ws.panes,
    { id: newId(), engine: null, title: `pane ${ws.panes.length + 1}` }
  ]
  const areas = defaultAreas(panes.length)
  const placed = panes.map((p, i) => ({ ...p, area: areas[i] }))
  state.workspaces = state.workspaces.map((w) =>
    w.id === workspaceId
      ? touchWorkspace({ ...w, layout: placed.length, panes: placed, zoomedPaneId: null })
      : w
  )
  persist()
  return true
}

/**
 * Close a pane for real: the PTY dies AND the slot goes away, so the workspace
 * re-tiles itself with one pane fewer (`layout` is the pane count everywhere
 * else, and the sidebar shows it as `live/layout`). A hole cannot be filled
 * without moving the neighbours, so a close re-flows — same geometry as
 * `workspaces:setLayout`. The last pane is only reset to idle: a workspace with
 * no panes would have no grid left to add one back in.
 */
function removePane(workspaceId: string, paneId: string): boolean {
  const ws = state.workspaces.find((w) => w.id === workspaceId)
  const pane = ws?.panes.find((p) => p.id === paneId)
  if (!ws || !pane) return false
  ptys.kill(paneId)
  closePaneNotification(paneId)
  board.paneEnd(paneId)
  const rest = ws.panes.filter((p) => p.id !== paneId)
  const kept = rest.length
    ? rest
    : [
        {
          ...pane,
          engine: null,
          title: 'pane 1',
          titleLocked: false,
          model: undefined,
          sessionHandle: undefined
        }
      ]
  const areas = defaultAreas(kept.length)
  const panes = kept.map((p, i) => ({ ...p, area: areas[i] }))
  state.workspaces = state.workspaces.map((w) =>
    w.id === workspaceId
      ? touchWorkspace({
          ...w,
          layout: panes.length,
          panes,
          zoomedPaneId: w.zoomedPaneId === paneId ? null : w.zoomedPaneId
        })
      : w
  )
  persist()
  return true
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

// Whole-GUI zoom. Ctrl+wheel arrives natively as 'zoom-changed'; Ctrl+plus/minus/0
// have no menu accelerators in a frameless window, so main intercepts them via
// before-input-event before the renderer (and xterm) ever sees the key.
// Persisting is debounced: a wheel roll would otherwise hit pq-state.json
// a dozen times per second.
let zoomPersistTimer: ReturnType<typeof setTimeout> | null = null

function setZoom(next: number): void {
  const z = Math.round(Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, next)) * 100) / 100
  const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null
  if (!wc) return
  wc.setZoomFactor(z)
  if (state.ui.zoom === z) return
  state.ui.zoom = z
  if (zoomPersistTimer) clearTimeout(zoomPersistTimer)
  zoomPersistTimer = setTimeout(persist, 250)
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
    title: 'pqTERM',
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Threat note: sandbox:false is required so preload can use webUtils.getPathForFile
      // for DnD absolute paths. Mitigations: contextIsolation:true, nodeIntegration:false,
      // no remote module; do not widen privileges further. Paths exposed to renderer are sensitive.
      sandbox: false,
      zoomFactor: state.ui.zoom
    }
  })

  mainWindow.on('blur', () => { focusedPaneId = null })
  mainWindow.webContents.on('did-start-loading', () => { focusedPaneId = null })
  mainWindow.on('closed', () => {
    focusedPaneId = null
    for (const paneId of paneNotifications.keys()) closePaneNotification(paneId)
    mainWindow = null
  })
  const reveal = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
  }
  mainWindow.setTitle('pqTERM')
  mainWindow.on('ready-to-show', reveal)
  mainWindow.webContents.on('did-finish-load', reveal)
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[pqTERM] load fail', code, desc, url)
    reveal()
  })
  setTimeout(reveal, 2500)
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isHttpUrl(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  // Renderer nie nawiguje okna poza nasze własne strony (dev URL, zbudowany
  // file://, fallback bez UI); cokolwiek innego idzie do przeglądarki.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL
    if (
      (dev && url.startsWith(dev)) ||
      url.startsWith('file://') ||
      url.startsWith('data:text/html;charset=utf-8,')
    ) return
    event.preventDefault()
    if (isHttpUrl(url)) void shell.openExternal(url)
  })
  // Wheel: step from the persisted value (never Chromium's internal level, so the
  // factor we set is always the single truth) — same math for keys and wheel.
  mainWindow.webContents.on('zoom-changed', (_e, dir) => {
    setZoom(state.ui.zoom * (dir === 'in' ? 1.1 : 0.9))
  })
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control) return
    const key = input.key
    let next: number | null = null
    if (key === '+' || key === '=' || key === 'NumpadAdd' || key === 'Add') next = state.ui.zoom + 0.1
    else if (key === '-' || key === '_' || key === 'NumpadSubtract' || key === 'Subtract') next = state.ui.zoom - 0.1
    else if (key === '0' || key === 'Numpad0') next = 1
    else return
    event.preventDefault()
    setZoom(next)
  })
  // Chromium resets the factor on every navigation (dev HMR, built file://, the
  // crash fallback) — re-apply the persisted factor after each load.
  mainWindow.webContents.on('did-finish-load', () => {
    const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null
    if (wc) wc.setZoomFactor(state.ui.zoom)
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
<h1>pqTERM</h1><p>brak zbudowanego UI (out/renderer).</p>
<p>odpal <b>pqTERM-dev</b> albo w katalogu projektu: npm run build</p>
             </body></html>`
          )
      )
    }
  }
}

function findUpdateScript(start: string): string | null {
  let dir = start
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'scripts', 'pqterm-update.cjs')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

function runUpdateScript(args: string[], timeoutMs: number): Promise<string> {
  const script = findUpdateScript(app.getAppPath())
  if (!script) return Promise.resolve('')
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const done = (value: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const child = spawn(process.execPath, [script, ...args], {
      cwd: dirname(script),
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout?.on('data', (buf) => { out += buf.toString() })
    child.stderr?.on('data', (buf) => { err += buf.toString() })
    timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
      } else child.kill()
      done('')
    }, timeoutMs)
    child.on('error', () => done(''))
    child.on('exit', (code) => {
      if (code && err.trim()) console.error('[pqTERM] update', err.trim())
      done(out)
    })
  })
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
    mode: productName() === 'pqTERM-dev' ? 'dev' : 'prod',
    name: 'pqTERM',
    edition: editionId(),
    build: buildNumber(),
    version: app.getVersion()
  }))
  ipcMain.handle('app:toggleSidebar', () => {
    state.sidebarOpen = !state.sidebarOpen
    persist()
  })
  ipcMain.handle('app:openUrl', (event, url: unknown) => {
    requireRenderer(event)
    if (!isHttpUrl(url)) return
    return shell.openExternal(url)
  })
  ipcMain.handle('update:check', async (event) => {
    requireRenderer(event)
    const out = await runUpdateScript(['--check'], 45000)
    try {
      const line = out.trim().split(/\n/).filter(Boolean).pop()
      if (!line) return null
      const parsed = JSON.parse(line) as { notice?: { text?: string } | null }
      const text = parsed.notice?.text
      return typeof text === 'string' && text.length > 0 && text.length < 400 ? text : null
    } catch {
      return null
    }
  })

  ipcMain.handle('state:load', () => state)

  ipcMain.handle('activity:get', (event) => {
    requireRenderer(event)
    return activity.get()
  })
  ipcMain.handle('activity:focus', (event, workspaceId: string | null, paneId: string | null) => {
    requireRenderer(event)
    if (workspaceId === null && paneId === null) {
      focusedPaneId = null
      return
    }
    if (typeof workspaceId !== 'string' || workspaceId.length > 128 ||
      typeof paneId !== 'string' || paneId.length > 128) throw new Error('Invalid terminal focus')
    const ws = state.workspaces.find((w) => w.id === workspaceId)
    if (!ws || ws.id !== state.activeWorkspaceId ||
      !ws.panes.some((p) => p.id === paneId && p.engine) ||
      (ws.zoomedPaneId && ws.zoomedPaneId !== paneId)) throw new Error('Invalid terminal focus')
    focusedPaneId = paneId
    if (!paneIsFocused(paneId)) {
      focusedPaneId = null
      return
    }
    activity.acknowledge(paneId)
  })
  ipcMain.handle('notifications:set', (event, settings: NotificationSettings) => {
    requireRenderer(event)
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      typeof settings.enabled !== 'boolean' || typeof settings.sound !== 'boolean') {
      throw new Error('Invalid notification settings')
    }
    state.notifications = { enabled: settings.enabled, sound: settings.sound }
    if (!settings.enabled) for (const paneId of paneNotifications.keys()) closePaneNotification(paneId)
    persist()
  })
  // Settings modal (accent, terminal font/cursor/scrollback). Same validator as
  // the state loader, so a bad renderer can only ever send values we accept.
  ipcMain.handle('ui:set', (event, patch: Partial<UiSettings>) => {
    requireRenderer(event)
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid ui settings')
    state.ui = sanitizeUi(patch, state.ui)
    persist()
  })

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

  // One click on a CLI tile → the official install/update/uninstall command in a
  // visible cmd/PowerShell window. pqTERM runs nothing itself; rescan on next click.
  const LIFECYCLE_ACTIONS: EngineAction[] = ['install', 'update', 'uninstall']

  function runLifecycle(id: EngineId, action: EngineAction): Promise<{ ok: boolean; message: string }> {
    const spec = specById(id)
    const script = lifecycleScript(spec, action)
    if (!script) {
      return Promise.resolve({
        ok: false,
        message: `${spec.name}: brak skryptu ${action} — użyj oficjalnego instalatora. ${spec.hint}`
      })
    }
    // Temp script file: paths and quoted URLs survive without nested-quote bugs.
    const dir = join(tmpdir(), 'pq-lifecycle')
    mkdirSync(dir, { recursive: true })
    // Unique name: cmd.exe reads a .cmd file incrementally, so a second click
    // must never overwrite a script whose window is still running.
    const file = join(dir, `${spec.id}-${action}-${Date.now()}.${script.kind}`)
    writeFileSync(file, script.body, 'utf8')
    // Elevated (UAC). Wait for the launcher: it exits as soon as the user
    // answers the consent prompt, and a non-zero exit is the only signal that
    // UAC was declined or the launch failed — report it instead of going silent.
    return new Promise((resolve) => {
      const child = spawn('powershell.exe', elevateArgs(script.kind, file), {
        // No `detached`: DETACHED_PROCESS makes PowerShell exit 0 without
        // launching Start-Process, i.e. the click silently does nothing.
        // windowsHide only hides the powershell launcher; the elevated
        // cmd/PowerShell window still shows up normally.
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        cwd: homedir()
      })
      let stderr = ''
      child.stderr?.on('data', (chunk) => {
        if (stderr.length < 4000) stderr += String(chunk)
      })
      child.on('error', (err) => {
        resolve({ ok: false, message: `${spec.name}: nie udało się podnieść uprawnień — ${err.message}` })
      })
      child.on('exit', (code) => {
        if (code === 0) {
          resolve({
            ok: true,
            message: `${spec.name}: ${action} jako Administrator w osobnym oknie — po zakończeniu kliknij kafelek, aby odświeżyć stan.`
          })
          return
        }
        const tail = stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? ''
        resolve({
          ok: false,
          message: `${spec.name}: ${action} nie wystartowało (UAC anulowany?)${tail ? ` — ${tail}` : ''}`
        })
      })
    })
  }

  ipcMain.handle('engines:lifecycle', async (_e, id: EngineId, action: EngineAction) => {
    if (!LIFECYCLE_ACTIONS.includes(action)) return { ok: false, message: 'nieznana akcja' }
    try {
      return await runLifecycle(id, action)
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('workspaces:pickFolder', async () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return null
    // A hidden xterm textarea can still hold window focus; the first folder
    // dialog then returns canceled until the dialog is opened again.
    if (!win.isFocused()) win.focus()
    const res = await dialog.showOpenDialog(win, {
      title: 'katalog workspace',
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('workspaces:openFolder', async (_e, id: unknown) => {
    const ws = typeof id === 'string' ? state.workspaces.find((w) => w.id === id) : undefined
    if (!ws) throw new Error('Nie znaleziono projektu.')
    if (!ws.cwd || !(await stat(ws.cwd)).isDirectory()) {
      throw new Error('Katalog projektu nie istnieje lub nie jest folderem.')
    }
    const error = await shell.openPath(ws.cwd)
    if (error) throw new Error(error)
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
      const engines = (input.engines || []).filter((e) => enabled.has(e) || isRawShell(e))
      const ws: Workspace = {
        id: newId(),
        title,
        cwd,
        layout: input.layout,
        panes: emptyPanes(input.layout, engines),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      try {
        trustWorkspace(cwd)
      } catch {
        /* ignore — seed/trust must not block create */
      }
      state.workspaces = [ws, ...state.workspaces]
      state.activeWorkspaceId = ws.id
      persist()
      attachBoard()
      return ws
    }
  )

  ipcMain.handle('workspaces:update', (_e, id: string, patch: Partial<Workspace>) => {
    // Renderer/telefon może podać tylko tytuł, cwd i zoom; zoomedPaneId musi
    // istnieć w tym workspace (albo być null = wyczyść), reszta ignorowana.
    if (typeof id !== 'string' || !patch || typeof patch !== 'object') return
    state.workspaces = state.workspaces.map((w) => {
      if (w.id !== id) return w
      const clean: Partial<Workspace> = {}
      if (typeof patch.title === 'string') clean.title = patch.title
      if (typeof patch.cwd === 'string') clean.cwd = patch.cwd
      if (patch.zoomedPaneId === null) clean.zoomedPaneId = null
      else if (
        typeof patch.zoomedPaneId === 'string' &&
        w.panes.some((p) => p.id === patch.zoomedPaneId)
      ) {
        clean.zoomedPaneId = patch.zoomedPaneId
      }
      return touchWorkspace({ ...w, ...clean, id: w.id })
    })
    persist()
  })

  ipcMain.handle('workspaces:reorder', (_e, ids: unknown) => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 64) return
    if (!ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128)) return
    const next = reorderByIds(state.workspaces, ids)
    if (next.length !== state.workspaces.length) return
    let same = true
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== state.workspaces[i]) { same = false; break }
    }
    if (same) return
    state.workspaces = next
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
    if (!validPanePatch(patch)) throw new Error('Invalid pane patch')
    state.workspaces = state.workspaces.map((w) => {
      if (w.id !== workspaceId) return w
      return touchWorkspace({
        ...w,
        panes: w.panes.map((p) => {
          if (p.id !== paneId) return p
          const engine = patch.engine ?? p.engine
          const next = updatePaneTitle(p, patch, engine ? specById(engine).name : 'idle')
          if (patch.title !== undefined && next.title !== p.title) board.paneTitle(paneId, next.title)
          return next
        })
      })
    })
    persist()
  })

  ipcMain.handle('workspaces:setLayout', (_e, id: string, layout: LayoutId) => {
    const ws = state.workspaces.find((w) => w.id === id)
    if (!ws) return
    const requested = paneCount(layout)
    if (!Number.isInteger(requested) || requested < 1) return
    const n = Math.min(requested, MAX_PANES)
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
    const areas = defaultAreas(n)
    panes = panes.map((p, i) => ({ ...p, area: areas[i] }))
    const zoomedPaneId = panes.some((p) => p.id === ws.zoomedPaneId) ? ws.zoomedPaneId : null
    state.workspaces = state.workspaces.map((w) =>
      w.id === id ? touchWorkspace({ ...w, layout: n, panes, zoomedPaneId }) : w
    )
    persist()
  })

  ipcMain.handle('workspaces:addPane', (_e, id: string) => {
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid workspace id')
    return addPane(id)
  })

  ipcMain.handle('workspaces:removePane', (_e, workspaceId: string, paneId: string) => {
    if (
      typeof workspaceId !== 'string' || workspaceId.length > 128 ||
      typeof paneId !== 'string' || paneId.length > 128
    ) throw new Error('Invalid pane close')
    return removePane(workspaceId, paneId)
  })

  ipcMain.handle(
    'workspaces:swapPanes',
    (_e, workspaceId: string, aId: string, bId: string) => {
      if (!aId || !bId || aId === bId) return
      state.workspaces = state.workspaces.map((w) => {
        if (w.id !== workspaceId) return w
        const order = [...w.panes]
        const ai = order.findIndex((p) => p.id === aId)
        const bi = order.findIndex((p) => p.id === bId)
        if (ai < 0 || bi < 0 || ai === bi) return w
        // True slot swap: panes trade array positions AND areas, so each slot
        // keeps its rectangle. In uniform grids (equal rects) this is what
        // visibly moves terminals — sessions stay alive (PTYs keyed by paneId,
        // components keep React keys, no respawn).
        const areas = new Map(resolveAreas(w.panes).map((e) => [e.id, e.area]))
        const pa = { ...order[ai], area: areas.get(bId) }
        const pb = { ...order[bi], area: areas.get(aId) }
        order[ai] = pb
        order[bi] = pa
        return touchWorkspace({ ...w, panes: order })
      })
      persist()
    }
  )

  ipcMain.handle(
    'workspaces:snapPane',
    (_e, workspaceId: string, paneId: string, zone: SnapZone) => {
      if (!paneId || !zone) return
      state.workspaces = state.workspaces.map((w) => {
        if (w.id !== workspaceId) return w
        const idx = w.panes.findIndex((p) => p.id === paneId)
        if (idx < 0) return w
        // center drop -> the pane fills the grid (existing zoom behavior)
        if (zone === 'full') {
          return touchWorkspace({ ...w, zoomedPaneId: paneId })
        }
        const next = snapAreas(w.panes.length, idx, zone)
        if (!next) return w
        const areas = w.panes.map((p, i) => ({ id: p.id, area: next[i] }))
        return touchWorkspace({ ...w, panes: applyAreasToPanes(w.panes, areas) })
      })
      persist()
    }
  )

  ipcMain.handle(
    'workspaces:resizePane',
    (_e, workspaceId: string, paneId: string, edge: ResizeEdge, dx: number, dy: number) => {
      if (
        typeof workspaceId !== 'string' || workspaceId.length > 128 ||
        typeof paneId !== 'string' || paneId.length > 128 ||
        !RESIZE_EDGES.includes(edge) || !Number.isFinite(dx) || !Number.isFinite(dy)
      ) throw new Error('Invalid pane resize')
      const ws = state.workspaces.find((w) => w.id === workspaceId)
      if (!ws || ws.zoomedPaneId || !ws.panes.some((p) => p.id === paneId)) {
        throw new Error('Pane cannot be resized')
      }
      const current = resolveAreas(ws.panes)
      const next = resizePanes(current, paneId, edge, dx, dy)
      if (next === current) return
      state.workspaces = state.workspaces.map((w) => w.id === workspaceId
        ? touchWorkspace({ ...w, panes: applyAreasToPanes(w.panes, next) })
        : w)
      persist()
    }
  )

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
      // paneId musi istnieć w tym workspace — sessionSeed/logi są kluczowane
      // po paneId, więc obcy id to path traversal w sessionLogPath.
      if (typeof input.paneId !== 'string' || !ws.panes.some((p) => p.id === input.paneId)) {
        throw new Error('nie ma takiego pane')
      }
      const sessionSeedData = sessionSeed(input.workspaceId, input.paneId)
      const spec = specById(input.engine)
      const provider = state.providers.find((p) => p.id === input.engine)
      const paneInWs = ws.panes.find((p) => p.id === input.paneId)
      const model = input.model ?? paneInWs?.model
      if (model !== undefined && model !== null && !(typeof model === 'string' && MODEL_RE.test(model))) {
        throw new Error('Invalid model')
      }

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
        return { id: input.paneId, replay: b.data, replaySeq: b.seq, existed: true, replayCols: b.cols, replayRows: b.rows }
      }

      const extraArgs = [
        ...(spec.args ?? []),
        ...(model && spec.modelFlag ? spec.modelFlag(model) : [])
      ]
      let resumeHandle = paneInWs?.sessionHandle
  const session = pickResume(input.workspaceId, input.engine, input.paneId, paneInWs?.sessionHandle)
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
        extraArgs,
        seedBuf: sessionSeedData.data
      })
      state.workspaces = state.workspaces.map((w) => {
        if (w.id !== input.workspaceId) return w
        return touchWorkspace({
          ...w,
          panes: w.panes.map((p) => {
            if (p.id !== input.paneId) return p
            return {
              ...p,
              engine: input.engine,
              title: p.titleLocked ? p.title : spec.name,
              model,
              sessionHandle: resumeHandle,
              // a different engine is a different conversation — never reuse its artifacts
              sessionId: p.engine === input.engine ? (p.sessionId ?? mintSessionId()) : mintSessionId()
            }
          })
        })
      })
      persist()
      void captureHandleLater(input.paneId)
      if (input.workspaceId === state.activeWorkspaceId) {
        const live = state.workspaces
          .find((w) => w.id === input.workspaceId)
          ?.panes.find((p) => p.id === input.paneId)
        board.paneStart(input.paneId, input.engine, live?.title || spec.name)
      }
      const replay = ptys.buffer(input.paneId)
      return { id: input.paneId, replay: replay.data, replaySeq: replay.seq, existed: false, replayCols: replay.cols, replayRows: replay.rows }
    }
  )

  ipcMain.on('term:write', (event, paneId: string, data: string) => {
    requireRenderer(event)
    ptys.write(paneId, data)
  })
  ipcMain.on('term:resize', (event, paneId: string, cols: number, rows: number) => {
    requireRenderer(event)
    ptys.resize(paneId, cols, rows)
  })
  // read-only: a pane that fell behind re-attaches from one authoritative
  // buffer instead of stitching the live stream chunk by chunk
  ipcMain.handle('term:buffer', (event, paneId: unknown) => {
    requireRenderer(event)
    if (typeof paneId !== 'string' || paneId.length > 128) throw new Error('Invalid pane id')
    const b = ptys.buffer(paneId)
    return { data: b.data, seq: b.seq, cols: b.cols, rows: b.rows }
  })
  ipcMain.handle('term:kill', (event, paneId: string) => {
    requireRenderer(event)
    ptys.kill(paneId)
  })
   // Main-process clipboard: no renderer permission prompts, works for
   // Ctrl+V / right-click paste and Ctrl+Shift+C copy in terminal panes.
   // Uses raw buffer approach for image detection (more reliable with Windows Snipping Tool).
   ipcMain.handle('term:clipboardRead', async () => {
     try {
       const text = clipboard.readText()
       if (text) return text

       // Try reading raw clipboard buffer to detect PNG images
       const buf = clipboard.readBuffer('clipboard')
       if (buf && buf.length > 4) {
         // Check PNG header: \x89PNG\r\n\x1a\n
         const header = buf.slice(0, 8).toString('hex')
         const pngHeader = '89504e470d0a1a0a'
         if (header === pngHeader || header.startsWith('89504e47')) {
           const ws = activeWs()
           if (!ws) return ''

           const dropsDir = join(ws.cwd, '.pq', 'drops')
           if (!existsSync(dropsDir)) {
             mkdirSync(dropsDir, { recursive: true })
           }

           const timestamp = Date.now()
           const filename = `clipboard-${timestamp}.png`
           const filepath = join(dropsDir, filename)
           writeFileSync(filepath, buf)

           return relative(ws.cwd, filepath)
         }
       }

       // Fallback to Electron's native image read
       const image = clipboard.readImage()
       if (!image.isEmpty()) {
         const ws = activeWs()
         if (!ws) return ''

         const dropsDir = join(ws.cwd, '.pq', 'drops')
         if (!existsSync(dropsDir)) {
           mkdirSync(dropsDir, { recursive: true })
         }

         const timestamp = Date.now()
         const filename = `clipboard-${timestamp}.png`
         const filepath = join(dropsDir, filename)
         writeFileSync(filepath, image.toPNG())

         return filepath
       }
       return ''
     } catch (err) {
       console.error(
         '[pqTERM] clipboard read failed:',
         err instanceof Error ? err.message : String(err)
       )
       return ''
     }
   })

    ipcMain.handle('term:clipboardReadImage', async () => {
     try {
       // Try raw buffer first (more reliable for Windows clipboard images
       // from Snipping Tool, browsers — same mechanism as clipboardRead).
       const buf = clipboard.readBuffer('clipboard')
       if (buf && buf.length > 4) {
         const header = buf.slice(0, 8).toString('hex')
         const pngHeader = '89504e470d0a1a0a'
         if (header === pngHeader || header.startsWith('89504e47')) {
           const ws = activeWs()
           if (!ws) return ''
           const dropsDir = join(ws.cwd, '.pq', 'drops')
           if (!existsSync(dropsDir)) mkdirSync(dropsDir, { recursive: true })
           const timestamp = Date.now()
           const filename = `clipboard-${timestamp}.png`
            const filepath = join(dropsDir, filename)
            writeFileSync(filepath, buf)
            return filepath
         }
       }

       const image = clipboard.readImage()
       if (!image.isEmpty()) {
         const ws = activeWs()
         if (!ws) return ''
         const dropsDir = join(ws.cwd, '.pq', 'drops')
         if (!existsSync(dropsDir)) mkdirSync(dropsDir, { recursive: true })
         const timestamp = Date.now()
         const filename = `clipboard-${timestamp}.png`
         const filepath = join(dropsDir, filename)
         writeFileSync(filepath, image.toPNG())
         return relative(ws.cwd, filepath)
       }
       return ''
     } catch (err) {
       console.error(
         '[pqTERM] clipboard read failed:',
         err instanceof Error ? err.message : String(err)
       )
       return ''
     }
   })
  ipcMain.handle('term:clipboardWrite', (_e, text: string) => {
    try {
      clipboard.writeText(typeof text === 'string' ? text : '')
    } catch {
      /* ignore */
    }
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
  app.setName('pqTERM')
  app.setAppUserModelId('com.pqterm.app')
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
  try {
    saveState(state)
  } catch (err) {
    console.error('[pqTERM] saveState:', err instanceof Error ? err.message : err)
  }
  registerIpc()
  // Okno rusza od razu po zarejestrowaniu IPC; resume/PTY bootują pod spodem,
  // a renderer sam prosi o replaye (term:spawn jest idempotentny).
  createWindow()
  board.setListener((snap) => mainWindow?.webContents.send('board:changed', snap))
  usage.onChange((m) => mainWindow?.webContents.send('usage:changed', m))
  remote.onChange((info) => mainWindow?.webContents.send('remote:changed', info))
  try {
    attachBoard()
  } catch (err) {
    console.error('[pqTERM] attachBoard:', err instanceof Error ? err.message : err)
  }
  // Scan engine session storage BEFORE any TUI starts (the opencode CLI becomes very
  // slow under contention with running opencode servers) so every pane can resume
  // its previous conversation right away.
  try {
    await primeResume(state.workspaces, state.providers)
  } catch (err) {
    console.error('[pqTERM]', err instanceof Error ? err.message : String(err))
  }
  restoreSessions()
  startTitlePoller()
  activityTimer = setInterval(() => activity.tick(), 1000)
  void runUpdateScript(['--ensure-cmd'], 15000)
  usage.start()
  void remote.restore().catch((err) => console.error('[pqTERM] remote', err))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  })
  .catch((err) => {
    console.error('[pqTERM] boot failed:', err instanceof Error ? err.message : err)
  })

app.on('window-all-closed', () => {
  persistSessions()
  ptys.killAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopTitlePoller()
  if (activityTimer) clearInterval(activityTimer)
  activityTimer = null
  for (const paneId of paneNotifications.keys()) closePaneNotification(paneId)
  usage.stop()
  bridge.stop()
  remote.stop()
  // a title adopted <400 ms before quit would otherwise never reach the board/state file
  flushTitleSideEffects()
  persistSessions()
  ptys.killAll()
  activity.dispose()
  // No-op when voice-host was never spawned (production default unchanged).
  // Does not auto-spawn. Cancel JSON-line over held peer socket when connected; else honest skip.
  shutdownVoiceHost()
})

// ---------------------------------------------------------------------------
// Overnight opt-in sketch — NOT called from app.whenReady / UI.
// Default OFF. Enable only via PQ_VOICE_HOST=1 or spawnVoiceHost({ enabled:true }).
// Host listens before spawn (pipe/TCP); StartListen/Cancel JSON-lines + Status reader; before-quit shutdownVoiceHost() — no-op when never spawned.
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
