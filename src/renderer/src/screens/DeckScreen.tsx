import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { AppSnapshot, EngineId, PaneActivity, PaneArea, SnapZone, UsageMap } from '../../../shared/types'
import { isRawShell } from '../../../shared/types'
import {
  FULL,
  resolveAreas,
  resizePanes,
  RESIZE_EDGES,
  snapAreas,
  swapAreasById,
  zoneNear,
  zoneRect,
  type ResizeEdge
} from '../../../shared/grid'
import Titlebar from '../components/Titlebar'
import Sidebar from '../components/Sidebar'
import TerminalPane from '../components/TerminalPane'
import NewWorkspaceModal from '../components/NewWorkspaceModal'
import SettingsModal from '../components/SettingsModal'

interface Hover {
  zone: SnapZone | null
  zoneStyle: { left: number; top: number; width: number; height: number } | null
  paneId: string | null
  haloStyle: { left: number; top: number; width: number; height: number } | null
  preview: { id: string; self: boolean; style: { left: number; top: number; width: number; height: number } }[] | null
}

interface PaneResize {
  workspaceId: string
  paneId: string
  edge: ResizeEdge
  layoutKey: string
  areas: { id: string; area: PaneArea }[]
  cleanup: () => void
}

const RESIZE_LABEL: Record<ResizeEdge, string> = {
  n: 'górna krawędź', s: 'dolna krawędź', e: 'prawa krawędź', w: 'lewa krawędź',
  ne: 'prawy górny narożnik', nw: 'lewy górny narożnik',
  se: 'prawy dolny narożnik', sw: 'lewy dolny narożnik'
}

const ZONE_LABEL: Record<SnapZone | 'none', string> = {
  full: 'pełny · zoom',
  left: 'lewa połowa',
  right: 'prawa połowa',
  top: 'górna połowa',
  bottom: 'dolna połowa',
  tl: 'góra-lewo',
  tr: 'góra-prawo',
  bl: 'dół-lewo',
  br: 'dół-prawo',
  none: ''
}

function rectStyle(r: PaneArea, rect: DOMRect) {
  return {
    left: rect.left + r.x * rect.width,
    top: rect.top + r.y * rect.height,
    width: r.w * rect.width,
    height: r.h * rect.height
  }
}

/** Pointer within this many px of the grid's outer frame snaps instead of swapping. */
const FRAME_SNAP_PX = 28

const NO_HOVER: Hover = { zone: null, zoneStyle: null, paneId: null, haloStyle: null, preview: null }

export default function DeckScreen({ snap }: { snap: AppSnapshot }) {
  const [modal, setModal] = useState<'new' | 'edit' | 'settings' | null>(null)
  const [editWsId, setEditWsId] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [renameNonce, setRenameNonce] = useState(0)
  const [usage, setUsage] = useState<UsageMap>({})
  const [activity, setActivity] = useState<Record<string, PaneActivity>>({})
  const [activityError, setActivityError] = useState('')
  const [focusRequest, setFocusRequest] = useState<{ workspaceId: string; paneId: string; nonce: number } | null>(null)
  const focusContext = useRef({ snap, modal })
  focusContext.current = { snap, modal }
  const reportedFocus = useRef<string | undefined>(undefined)
  const [drag, setDrag] = useState<{ paneId: string; x: number; y: number } | null>(null)
  const [hover, setHover] = useState<Hover>(NO_HOVER)
  const [resizePreview, setResizePreview] = useState<Pick<PaneResize, 'workspaceId' | 'layoutKey' | 'areas'> | null>(null)
  const [resizeError, setResizeError] = useState('')
  const resizeRef = useRef<PaneResize | null>(null)
  const ws = snap.workspaces.find((w) => w.id === snap.activeWorkspaceId) ?? null
  const editWs = snap.workspaces.find((w) => w.id === editWsId) ?? null
  const visitedWorkspaces = useRef(new Set<string>())
  useLayoutEffect(() => {
    if (ws) visitedWorkspaces.current.add(ws.id)
    for (const id of visitedWorkspaces.current) {
      if (!snap.workspaces.some((w) => w.id === id)) visitedWorkspaces.current.delete(id)
    }
  }, [ws, snap.workspaces])
  const zoomedId = ws?.zoomedPaneId ?? null

  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ paneId: string; x: number; y: number; started: boolean } | null>(null)
  const hoverRef = useRef<Hover>(NO_HOVER)
  const handlersRef = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void; cancel: () => void } | null>(null)

  const panes = ws?.panes ?? []
  // Window-level drag handlers outlive a render and memoized panes can hold a handler prop from
  // an earlier one, so anything they read goes through here rather than the render closure.
  const areas = useMemo(() => resolveAreas(panes), [panes])
  // Geometry only: terminal-generated titles must not cancel a pointer gesture.
  const layoutKey = JSON.stringify([ws?.id, ws?.layout, zoomedId, areas])
  const liveRef = useRef({ ws, panes, zoomedId, layoutKey })
  liveRef.current = { ws, panes, zoomedId, layoutKey }
  const draggedTitle = drag ? panes.find((p) => p.id === drag.paneId)?.title ?? '' : ''

  function requestPaneFocus(workspaceId: string, paneId: string): void {
    setFocus(paneId)
    setFocusRequest((previous) => ({ workspaceId, paneId, nonce: (previous?.nonce ?? 0) + 1 }))
  }

  function reportTerminalFocus(): void {
    const current = focusContext.current
    const activeWorkspace = current.snap.workspaces.find((w) => w.id === current.snap.activeWorkspaceId)
    const element = document.activeElement
    const paneId = element instanceof HTMLElement && element.closest('.xterm-host')
      ? element.closest<HTMLElement>('[data-pane-id]')?.dataset.paneId
      : undefined
    const pane = activeWorkspace?.panes.find((p) => p.id === paneId && p.engine)
    const visible = document.hasFocus() && document.visibilityState === 'visible' && !current.modal &&
      pane && (!activeWorkspace?.zoomedPaneId || activeWorkspace.zoomedPaneId === pane.id)
    const workspaceId = visible ? activeWorkspace!.id : null
    const focusedPaneId = visible ? pane.id : null
    const key = JSON.stringify([workspaceId, focusedPaneId])
    if (reportedFocus.current === key) return
    reportedFocus.current = key
    if (focusedPaneId) setFocus(focusedPaneId)
    void window.pq.activity.focus(workspaceId, focusedPaneId).catch((error) => {
      console.error('[pqTERM] activity focus failed', error)
      setActivityError('Nie udało się zgłosić fokusu terminala.')
    })
  }

  useEffect(() => {
    let disposed = false
    // Events received during get() win, including removals; untouched panes come from the snapshot.
    let pending: Map<string, PaneActivity | null> | null = new Map()
    const off = window.pq.activity.onChange((paneId, next) => {
      pending?.set(paneId, next)
      setActivity((previous) => {
        const updated = { ...previous }
        if (next) updated[paneId] = next
        else delete updated[paneId]
        return updated
      })
    })
    void window.pq.activity.get().then((initial) => {
      if (disposed) return
      const merged = { ...initial }
      for (const [paneId, next] of pending!) {
        if (next) merged[paneId] = next
        else delete merged[paneId]
      }
      pending = null
      setActivity(merged)
    }).catch((error) => {
      pending = null
      if (disposed) return
      console.error('[pqTERM] activity snapshot failed', error)
      setActivityError('Nie udało się wczytać statusów terminali.')
    })
    const offFocus = window.pq.activity.onFocus((workspaceId, paneId) => {
      setModal(null)
      requestPaneFocus(workspaceId, paneId)
    })
    const onFocusOut = () => queueMicrotask(() => { if (!disposed) reportTerminalFocus() })
    document.addEventListener('focusin', reportTerminalFocus)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('visibilitychange', reportTerminalFocus)
    window.addEventListener('focus', reportTerminalFocus)
    window.addEventListener('blur', reportTerminalFocus)
    reportTerminalFocus()
    return () => {
      disposed = true
      off()
      offFocus()
      document.removeEventListener('focusin', reportTerminalFocus)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('visibilitychange', reportTerminalFocus)
      window.removeEventListener('focus', reportTerminalFocus)
      window.removeEventListener('blur', reportTerminalFocus)
      void window.pq.activity.focus(null, null).catch((error) => console.error('[pqTERM] activity focus cleanup failed', error))
    }
  }, [])

  useLayoutEffect(() => {
    reportTerminalFocus()
  }, [snap.activeWorkspaceId, ws?.panes, zoomedId, modal])

  function setZoomFor(wId: string, paneId: string | null): void {
    void window.pq.workspaces.update(wId, { zoomedPaneId: paneId })
    if (paneId) requestPaneFocus(wId, paneId)
  }

  function toggleZoomFor(
    wId: string,
    wsZoomed: string | null | undefined,
    paneId: string | null
  ): void {
    if (!paneId) return
    setZoomFor(wId, wsZoomed === paneId ? null : paneId)
  }

  function setZoom(paneId: string | null): void {
    if (!ws) return
    setZoomFor(ws.id, paneId)
  }

  function toggleZoom(paneId: string | null): void {
    if (!ws || !paneId) return
    toggleZoomFor(ws.id, ws.zoomedPaneId, paneId)
  }

  function addPane(workspaceId: string): void {
    void window.pq.workspaces.addPane(workspaceId).catch((error) => {
      console.error('[pqTERM] add pane failed', error)
      setActivityError('Nie udało się dodać okna CLI.')
    })
  }

  function closePane(workspaceId: string, paneId: string): void {
    // liveRef, not this render's closure: a memoized pane may hold an older
    // handler. Focus is only ours to move in the workspace we are showing.
    const live = liveRef.current
    if (live.ws?.id === workspaceId) {
      setFocus((current) =>
        current === paneId ? live.panes.find((p) => p.id !== paneId)?.id ?? null : current
      )
    }
    void window.pq.workspaces.removePane(workspaceId, paneId).catch((error) => {
      console.error('[pqTERM] close pane failed', error)
      setActivityError('Nie udało się zamknąć okna CLI.')
    })
  }

  useEffect(() => {
    let off: (() => void) | undefined
    void window.pq.usage.get().then(setUsage)
    off = window.pq.usage.onChange(setUsage)
    return () => off?.()
  }, [])

  function cancelResize(): void {
    resizeRef.current?.cleanup()
    resizeRef.current = null
    setResizePreview(null)
  }

  useLayoutEffect(() => {
    if (resizeRef.current && resizeRef.current.layoutKey !== layoutKey) cancelResize()
  }, [layoutKey])

  useEffect(() => () => {
    resizeRef.current?.cleanup()
    resizeRef.current = null
  }, [])

  function commitResize(session: PaneResize, dx: number, dy: number): void {
    if (resizeRef.current !== session) return
    session.cleanup()
    if (liveRef.current.layoutKey !== session.layoutKey) {
      cancelResize()
      return
    }
    const next = resizePanes(session.areas, session.paneId, session.edge, dx, dy)
    if (JSON.stringify(next) === JSON.stringify(session.areas)) {
      cancelResize()
      return
    }
    setResizePreview({ ...session, areas: next })
    void window.pq.workspaces.resizePane(session.workspaceId, session.paneId, session.edge, dx, dy)
      .then(() => {
        if (resizeRef.current !== session) return
        // Main broadcasts before resolving. Keep the final preview through the
        // next frame so React can apply that snapshot without snapping back.
        // Compose with the gesture cleanup — the layoutKey effect may cancel
        // first when the broadcast render lands before this frame.
        const prev = session.cleanup
        const frame = requestAnimationFrame(() => {
          if (resizeRef.current === session) cancelResize()
        })
        session.cleanup = () => {
          prev()
          cancelAnimationFrame(frame)
        }
      })
      .catch(() => {
        if (resizeRef.current !== session) return
        cancelResize()
        setResizeError('Nie udało się zmienić rozmiaru okien. Spróbuj ponownie.')
      })
  }

  function startResize(paneId: string, edge: ResizeEdge): PaneResize | null {
    const live = liveRef.current
    // A pointerdown always means the previous gesture is over — never let a
    // session that lost its async cleanup race block a new one.
    if (resizeRef.current) {
      resizeRef.current.cleanup()
      resizeRef.current = null
      setResizePreview(null)
    }
    if (dragRef.current || !live.ws || live.zoomedId || live.panes.length < 2) return null
    const session: PaneResize = {
      workspaceId: live.ws.id, paneId, edge, layoutKey: live.layoutKey,
      areas: resolveAreas(live.panes), cleanup: () => {}
    }
    resizeRef.current = session
    setResizeError('')
    return session
  }

  function beginResize(paneId: string, edge: ResizeEdge, e: ReactPointerEvent<HTMLButtonElement>): void {
    if (e.button !== 0 || !e.isPrimary) return
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return
    const session = startResize(paneId, edge)
    if (!session) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.focus()
    const pointerId = e.pointerId
    const startX = e.clientX
    const startY = e.clientY
    let dx = 0
    let dy = 0
    let frame = 0
    const preview = () => {
      frame = 0
      if (resizeRef.current !== session) return
      if (liveRef.current.layoutKey !== session.layoutKey) {
        cancelResize()
        return
      }
      setResizePreview({ ...session, areas: resizePanes(session.areas, paneId, edge, dx, dy) })
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      ev.preventDefault()
      dx = (ev.clientX - startX) / rect.width
      dy = (ev.clientY - startY) / rect.height
      if (!frame) frame = requestAnimationFrame(preview)
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      // The release can arrive before the last move's animation frame.
      commitResize(session, (ev.clientX - startX) / rect.width, (ev.clientY - startY) / rect.height)
    }
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) cancelResize()
    }
    const escape = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      cancelResize()
    }
    const blur = () => cancelResize()
    session.cleanup = () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('blur', blur)
      document.body.classList.remove('pane-resizing')
      document.body.style.removeProperty('--pane-resize-cursor')
    }
    document.body.classList.add('pane-resizing')
    document.body.style.setProperty('--pane-resize-cursor', edge.length === 2 ? (edge === 'ne' || edge === 'sw' ? 'nesw-resize' : 'nwse-resize') : (edge === 'e' || edge === 'w' ? 'ew-resize' : 'ns-resize'))
    setResizePreview({ ...session })
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('blur', blur)
  }

  function keyResize(paneId: string, edge: ResizeEdge, e: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const step = e.shiftKey ? 0.05 : 0.01
    const dx = /[ew]/.test(edge) ? (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0) : 0
    const dy = /[ns]/.test(edge) ? (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0) : 0
    if (!dx && !dy) return
    e.preventDefault()
    e.stopPropagation()
    const session = startResize(paneId, edge)
    if (session) commitResize(session, dx, dy)
  }
  function pushHover(h: Hover): void {
    hoverRef.current = h
    setHover(h)
  }

  function cleanupDrag(): void {
    const h = handlersRef.current
    if (h) {
      window.removeEventListener('pointermove', h.move)
      window.removeEventListener('pointerup', h.up)
      window.removeEventListener('pointercancel', h.cancel)
      handlersRef.current = null
    }
    document.body.classList.remove('dragging')
  }

  useEffect(
    () => () => {
      cleanupDrag()
    },
    []
  )

  function beginDrag(paneId: string, e: ReactPointerEvent<HTMLElement>): void {
    if (liveRef.current.zoomedId || resizeRef.current) return
    e.preventDefault()
    cleanupDrag()
    dragRef.current = { paneId, x: e.clientX, y: e.clientY, started: false }
    setDrag({ paneId, x: e.clientX, y: e.clientY })
    const move = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      if (!d.started) {
        if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 4) return
        d.started = true
      }
      d.x = ev.clientX
      d.y = ev.clientY
      document.body.classList.add('dragging')
      setDrag({ paneId: d.paneId, x: ev.clientX, y: ev.clientY })
      const rect = gridRef.current?.getBoundingClientRect()
      if (!rect || rect.width < 40 || rect.height < 40) {
        pushHover(NO_HOVER)
        return
      }
      const nx = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width))
      const ny = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height))
      // Frame-vs-body rule: dropping at the grid's outer frame snaps (halves /
      // corners); dropping on a pane body swaps slots. This keeps every pane
      // reachable — in a 9-grid the corner cells' centers would otherwise
      // always fall into corner snap zones and slot-swap would be impossible.
      const dFrame = Math.min(
        ev.clientX - rect.left,
        rect.right - ev.clientX,
        ev.clientY - rect.top,
        rect.bottom - ev.clientY
      )
      const rawZone = zoneNear(nx, ny)
      const frameZone = rawZone === 'full' ? null : rawZone
      let h: Hover = NO_HOVER
      // Zoom / pane set may have changed since this handler was created.
      const live = liveRef.current
      const paneIds = live.panes.map((p) => p.id)
      const selfIdx = paneIds.indexOf(d.paneId)
      if (dFrame <= FRAME_SNAP_PX && frameZone) {
        const z = zoneRect(frameZone)
        h = {
          zone: frameZone,
          paneId: null,
          zoneStyle: {
            left: rect.left + z.x * rect.width,
            top: rect.top + z.y * rect.height,
            width: z.w * rect.width,
            height: z.h * rect.height
          },
          haloStyle: null,
          preview: (() => {
            const next = selfIdx >= 0 ? snapAreas(live.panes.length, selfIdx, frameZone) : null
            if (!next) return null
            return live.panes.map((p, i) => ({
              id: p.id,
              self: p.id === d.paneId,
              style: rectStyle(next[i], rect)
            }))
          })()
        }
      } else {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)
        const paneEl = el?.closest?.('[data-pane-id]') as HTMLElement | null
        const id = paneEl?.dataset.paneId ?? null
        if (paneEl && id && id !== d.paneId) {
          const r = paneEl.getBoundingClientRect()
          const swapped = swapAreasById(resolveAreas(live.panes), d.paneId, id)
          h = {
            zone: null,
            paneId: id,
            zoneStyle: null,
            haloStyle: { left: r.left, top: r.top, width: r.width, height: r.height },
            preview: swapped.map((a) => ({
              id: a.id,
              self: a.id === d.paneId,
              style: rectStyle(a.area, rect)
            }))
          }
        }
      }
      pushHover(h)
    }
    const finish = async (ev: PointerEvent) => {
      const d = dragRef.current
      cleanupDrag()
      const h = hoverRef.current
      pushHover(NO_HOVER)
      setDrag(null)
      dragRef.current = null
      const { ws: wsNow } = liveRef.current
      if (!d?.started || !wsNow) return
      if (h.zone) await window.pq.workspaces.snapPane(wsNow.id, d.paneId, h.zone)
      else if (h.paneId) await window.pq.workspaces.swapPanes(wsNow.id, d.paneId, h.paneId)
    }
    const cancel = () => {
      dragRef.current = null
      cleanupDrag()
      pushHover(NO_HOVER)
      setDrag(null)
    }
    handlersRef.current = { move, up: finish, cancel }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ws) return
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.code !== 'KeyF' && e.code !== 'KeyG' && e.code !== 'KeyR') return
      }
      if (e.code === 'KeyF') {
        e.preventDefault()
        const id = focus ?? ws.panes[0]?.id
        if (id) toggleZoom(id)
        return
      }
      if (e.code === 'KeyG') {
        e.preventDefault()
        setZoom(null)
        return
      }
      if (e.code === 'KeyT') {
        e.preventDefault()
        if (focus) setRenameNonce((n) => n + 1)
        return
      }
      if (e.code === 'KeyR') {
        e.preventDefault()
        const engine =
          ws.panes.find((p) => p.id === focus)?.engine ??
          ws.panes.find((p) => p.engine)?.engine ??
          'grok'
        void window.pq.panes.fill({ engine })
        return
      }
      if (e.code === 'KeyB') {
        e.preventDefault()
        void window.pq.app.toggleSidebar()
        return
      }
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5))
        if (n >= 1 && n <= 9) {
          e.preventDefault()
          const pane = ws.panes[n - 1]
          if (pane) setZoom(pane.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ws, focus])

  return (
    <>
      <Titlebar />
      <div className={`deck${zoomedId ? ' zen' : ''}`}>
        <nav className="dock">
          <button
            className={snap.sidebarOpen ? 'dockbtn on' : 'dockbtn'}
            title="workspaces"
            onClick={() => window.pq.app.toggleSidebar()}
          >
            ⌂
          </button>
          <button className="dockbtn" title="nowy workspace" onClick={() => setModal('new')}>
            +
          </button>
          {/* one gear for the whole app: look, terminal, notifications, engines, phone */}
          <button
            className="dockbtn"
            title="ustawienia pqTERM"
            aria-label="Ustawienia pqTERM"
            onClick={() => setModal('settings')}
          >
            ⚙
          </button>
          <button className="dockbtn" title="update CLIs — aktualizuje tylko zainstalowane silniki" onClick={() => window.pq.sync.start()}>
            ↻
          </button>
          <div className="sp" />
          {snap.user?.picture ? (
            <img className="avatar" src={snap.user.picture} alt="" title={snap.user.email} />
          ) : (
            <div className="avatar" title={snap.user?.email}>
              {(snap.user?.email ?? '?')[0]}
            </div>
          )}
          <button className="dockbtn" title="wyloguj" onClick={() => window.pq.auth.signOut()}>
            ⌽
          </button>
        </nav>
        <Sidebar
          snap={snap}
          activity={activity}
          onNew={() => setModal('new')}
          onEdit={(id) => {
            setEditWsId(id)
            setModal('edit')
          }}
          focusPane={(wId, paneId) => {
            requestPaneFocus(wId, paneId)
            const target = snap.workspaces.find((w) => w.id === wId)
            if (target?.zoomedPaneId) {
              void window.pq.workspaces.update(wId, { zoomedPaneId: paneId }).catch((error) => {
                console.error('[pqTERM] pane focus routing failed', error)
                setActivityError('Nie udało się pokazać wybranego terminala.')
              })
            }
          }}
        />
        <main className="stage">
          {ws ? (
            <>
              {zoomedId ? (
                <div className="zoom-strip" title="przełącz powiększony slot">
                  <button className="ghost" onClick={() => setZoom(null)} title="siatka (ctrl+shift+g)">
                    grid
                  </button>
                  {ws.panes.map((p) => (
                    <button
                      key={p.id}
                      className={p.id === zoomedId ? 'on' : ''}
                      onClick={() => setZoom(p.id === zoomedId ? null : p.id)}
                      title={p.title}
                    >
                      {p.engine ? p.title : 'idle'}
                    </button>
                  ))}
                </div>
              ) : null}
              {drag ? (
                <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 14 }}>
                  {draggedTitle}
                </div>
              ) : null}
              {hover.zoneStyle ? (
                <div
                  className={`snap-zone zone-${hover.zone}`}
                  style={hover.zoneStyle}
                  data-zone={hover.zone ?? ''}
                >
                  <span className="zone-label">{hover.zone ? ZONE_LABEL[hover.zone] : ''}</span>
                </div>
              ) : null}
              {hover.haloStyle ? (
                <div className="swap-halo" style={hover.haloStyle} />
              ) : null}
              {hover.preview?.map((p) => (
                <div
                  key={p.id}
                  className={`layout-preview${p.self ? ' self' : ''}`}
                  style={p.style}
                />
              ))}
              {/* Keep visited terminal views alive, but do not start unvisited workspaces. */}
              {snap.workspaces.map((w) => {
                const active = w.id === ws?.id
                if (!active && !visitedWorkspaces.current.has(w.id)) return null
                const wZoomed = w.zoomedPaneId ?? null
                const preview = active && resizePreview?.workspaceId === w.id && resizePreview.layoutKey === layoutKey ? resizePreview : null
                const wAreas = preview?.areas ?? resolveAreas(w.panes)
                const wAreaById = new Map(wAreas.map((a) => [a.id, a.area]))
                return (
                  <div key={w.id} className={`ws-grid${active ? ' active' : ''}`}>
                    <div ref={active ? gridRef : undefined} className={`grid${wZoomed ? ' zoomed' : ''}${preview ? ' resizing' : ''}`}>
                      {w.panes.map((p, i) => (
                        <TerminalPane
                          key={p.id}
                          pane={p}
                          workspaceId={w.id}
                          cwd={w.cwd}
                          providers={snap.providers}
                          focused={active && focus === p.id}
                          zoomed={wZoomed === p.id}
                          renameNonce={active && focus === p.id ? renameNonce : 0}
                          usage={p.engine ? usage[p.engine] : undefined}
                          activity={activity[p.id]}
                          focusRequest={active && !modal && (!wZoomed || wZoomed === p.id) && focusRequest?.workspaceId === w.id && focusRequest.paneId === p.id ? focusRequest.nonce : 0}
                          index={i + 1}
                          area={wZoomed === p.id ? FULL : wAreaById.get(p.id)}
                          fontId={snap.ui.fontId}
                          fontSize={snap.ui.fontSize}
                          cursorStyle={snap.ui.cursorStyle}
                          cursorBlink={snap.ui.cursorBlink}
                          scrollback={snap.ui.scrollback}
                          onAdd={() => addPane(w.id)}
                          onClose={() => closePane(w.id, p.id)}
                          onDragStart={beginDrag}
                          onFocus={() => setFocus(p.id)}
                          onZoom={() => toggleZoomFor(w.id, wZoomed, p.id)}
                        />
                      ))}
                      {active && !wZoomed && w.panes.length > 1 ? wAreas.flatMap(({ id, area }) => {
                        const internal = {
                          n: area.y > 1e-5, s: area.y + area.h < 1 - 1e-5,
                          w: area.x > 1e-5, e: area.x + area.w < 1 - 1e-5
                        }
                        return RESIZE_EDGES.filter((edge) => [...edge].every((side) => internal[side as keyof typeof internal])).map((edge) => {
                          const horizontal = edge === 'n' || edge === 's'
                          const vertical = edge === 'e' || edge === 'w'
                          const x = edge.includes('e') ? area.x + area.w : area.x
                          const y = edge.includes('s') ? area.y + area.h : area.y
                          const label = `Zmień rozmiar okna ${w.panes.findIndex((p) => p.id === id) + 1}: ${RESIZE_LABEL[edge]}. Strzałki: 1%, Shift: 5%.`
                          return (
                            <button
                              key={`${id}-${edge}`}
                              type="button"
                              className={`pane-resize-handle resize-${edge}`}
                              aria-label={label}
                              title={label}
                              style={{
                                left: horizontal ? `calc(${area.x * 100}% + 6px)` : `calc(${x * 100}% - 4px)`,
                                top: vertical ? `calc(${area.y * 100}% + 6px)` : `calc(${y * 100}% - 4px)`,
                                width: horizontal ? `calc(${area.w * 100}% - 12px)` : '8px',
                                height: vertical ? `calc(${area.h * 100}% - 12px)` : '8px'
                              }}
                              onPointerDown={(e) => beginResize(id, edge, e)}
                              onKeyDown={(e) => keyResize(id, edge, e)}
                            />
                          )
                        })
                      }) : null}
                    </div>
                  </div>
                )
              })}
            </>
          ) : (
            <div className="blank">
              <div>
                brak aktywnego workspace.
                <br />
                naciśnij <kbd>+</kbd> albo utwórz go z explorera po lewej.
              </div>
            </div>
          )}
        </main>
      </div>
      {/* The old status footer is gone; only real trouble surfaces, as a floating
          line that stays out of the way of the grid. */}
      {resizeError || activityError ? (
        <div className="pane-alert" role="status">
          {resizeError || activityError}
        </div>
      ) : null}
      {modal === 'new' ? (
        <NewWorkspaceModal providers={snap.providers} onClose={() => setModal(null)} />
      ) : null}
      {modal === 'edit' && editWs ? (
        <NewWorkspaceModal
          providers={snap.providers}
          workspace={editWs}
          onClose={() => {
            setEditWsId(null)
            setModal(null)
          }}
        />
      ) : null}
      {modal === 'settings' ? <SettingsModal snap={snap} onClose={() => setModal(null)} /> : null}
    </>
  )
}