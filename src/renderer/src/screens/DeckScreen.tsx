import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { AppSnapshot, EngineId, LayoutId, PaneArea, SnapZone, UsageMap } from '../../../shared/types'
import { LAYOUTS } from '../../../shared/types'
import {
  FULL,
  resolveAreas,
  snapAreas,
  swapAreasById,
  zoneNear,
  zoneRect
} from '../../../shared/grid'
import Titlebar from '../components/Titlebar'
import Sidebar from '../components/Sidebar'
import TerminalPane from '../components/TerminalPane'
import NewWorkspaceModal from '../components/NewWorkspaceModal'
import ProvidersModal from '../components/ProvidersModal'
import RemotePanel from '../components/RemotePanel'

interface Hover {
  zone: SnapZone | null
  zoneStyle: { left: number; top: number; width: number; height: number } | null
  paneId: string | null
  haloStyle: { left: number; top: number; width: number; height: number } | null
  preview: { id: string; self: boolean; style: { left: number; top: number; width: number; height: number } }[] | null
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
  const [modal, setModal] = useState<'new' | 'providers' | 'remote' | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [renameNonce, setRenameNonce] = useState(0)
  const [usage, setUsage] = useState<UsageMap>({})
  const [cast, setCast] = useState('')
  const [drag, setDrag] = useState<{ paneId: string; x: number; y: number } | null>(null)
  const [hover, setHover] = useState<Hover>(NO_HOVER)
  const ws = snap.workspaces.find((w) => w.id === snap.activeWorkspaceId) ?? null
  const detected = snap.providers.filter((p) => p.installed && p.id !== 'shell').length
  const authed = snap.providers.filter((p) => p.detectedAuth && p.id !== 'shell').length
  const zoomedId = ws?.zoomedPaneId ?? null
  const zoomedPane = ws?.panes.find((p) => p.id === zoomedId) ?? null

  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ paneId: string; x: number; y: number; started: boolean } | null>(null)
  const hoverRef = useRef<Hover>(NO_HOVER)
  const handlersRef = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void; cancel: () => void } | null>(null)

  const panes = ws?.panes ?? []
  const areas = useMemo(() => resolveAreas(panes), [panes])
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a.area])), [areas])
  const draggedTitle = drag ? panes.find((p) => p.id === drag.paneId)?.title ?? '' : ''

  const center = useMemo(() => {
    if (!ws) return 'no workspace'
    if (zoomedPane) {
      return (
        <>
          workspace · <b>{ws.title}</b>
          <span className="sep"> · </span>
          <b>{zoomedPane.title}</b>
        </>
      )
    }
    return (
      <>
        workspace · <b>{ws.title}</b>
      </>
    )
  }, [ws, zoomedPane])

  function setZoomFor(wId: string, paneId: string | null): void {
    void window.pq.workspaces.update(wId, { zoomedPaneId: paneId })
    if (paneId) setFocus(paneId)
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

  useEffect(() => {
    let off: (() => void) | undefined
    void window.pq.usage.get().then(setUsage)
    off = window.pq.usage.onChange(setUsage)
    return () => off?.()
  }, [])

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
    if (zoomedId) return
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
      const paneIds = panes.map((p) => p.id)
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
            const next = selfIdx >= 0 ? snapAreas(panes.length, selfIdx, frameZone) : null
            if (!next) return null
            return panes.map((p, i) => ({
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
          const swapped = swapAreasById(resolveAreas(panes), d.paneId, id)
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
      if (!d?.started || !ws) return
      if (h.zone) await window.pq.workspaces.snapPane(ws.id, d.paneId, h.zone)
      else if (h.paneId) await window.pq.workspaces.swapPanes(ws.id, d.paneId, h.paneId)
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

  function changeLayout(delta: number): void {
    if (!ws) return
    const n = Math.min(12, Math.max(1, ws.layout + delta))
    void window.pq.workspaces.setLayout(ws.id, n as LayoutId)
  }

  return (
    <>
      <Titlebar center={center} />
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
          <button className="dockbtn" title="providers" onClick={() => setModal('providers')}>
            ⚙
          </button>
          <button className="dockbtn" title="sync engines" onClick={() => window.pq.sync.start()}>
            ↻
          </button>
          <button className="dockbtn" title="telefon / remote" onClick={() => setModal('remote')}>
            ◯
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
          onNew={() => setModal('new')}
          focusPane={(wId, paneId) => {
            setFocus(paneId)
            const target = snap.workspaces.find((w) => w.id === wId)
            if (target?.zoomedPaneId) {
              void window.pq.workspaces.update(wId, { zoomedPaneId: paneId })
            }
          }}
        />
        <main className="stage">
          {ws ? (
            <>
              <div className="stage-bar">
                <div className="layout-switch">
                  <button
                    className="stepper"
                    title="mniej okien"
                    onClick={() => changeLayout(-1)}
                  >
                    −
                  </button>
                  <span className="count" title="liczba okien">
                    {ws.layout}
                  </span>
                  <button
                    className="stepper"
                    title="więcej okien"
                    onClick={() => changeLayout(1)}
                  >
                    +
                  </button>
                  <span className="sep" />
                  {LAYOUTS.map((n) => (
                    <button
                      key={n}
                      className={ws.layout === n ? 'on' : ''}
                      onClick={() => window.pq.workspaces.setLayout(ws.id, n as LayoutId)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {zoomedId ? (
                  <div className="pane-strip" title="przełącz powiększony slot">
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
                ) : (
                  <span className="path" title={ws.cwd}>
                    {ws.cwd}
                  </span>
                )}
                <div className="grow" />
                {(() => {
                  const idle = ws.panes.filter((p) => !p.engine).length
                  const focusedEngine =
                    ws.panes.find((p) => p.id === focus)?.engine ??
                    ws.panes.find((p) => p.engine)?.engine ??
                    'grok'
                  return (
                    <>
                      <button
                        className="ghost"
                        disabled={!idle}
                        title="odpal ten sam silnik w pustych oknach (ctrl+shift+r)"
                        onClick={() =>
                          window.pq.panes.fill({ engine: focusedEngine as EngineId })
                        }
                      >
                        fill rest{idle ? ` ${idle}` : ''}
                      </button>
                      <input
                        className="broadcast"
                        value={cast}
                        placeholder="wyślij do wszystkich…"
                        title="pqTERM wyśle ten prompt do wszystkich okien tego silnika; puste od razu odpali"
                        onChange={(e) => setCast(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' || !cast.trim()) return
                          e.preventDefault()
                          const text = cast.trim()
                          setCast('')
                          void window.pq.panes.fill({
                            engine: focusedEngine as EngineId,
                            prompt: text
                          })
                        }}
                      />
                    </>
                  )
                })()}
                <button className="ghost" onClick={() => window.pq.workspaces.remove(ws.id)}>
                  delete ws
                </button>
              </div>
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
              {snap.workspaces.map((w) => {
                const active = w.id === snap.activeWorkspaceId
                const zId = w.zoomedPaneId ?? null
                return (
                  <div key={w.id} className={`ws-grid${active ? ' active' : ''}`}>
                    <div
                      ref={active ? gridRef : undefined}
                      className={`grid${zId ? ' zoomed' : ''}`}
                    >
                      {w.panes.map((p, i) => (
                        <TerminalPane
                          key={p.id}
                          pane={p}
                          workspaceId={w.id}
                          cwd={w.cwd}
                          providers={snap.providers}
                          focused={active && focus === p.id}
                          zoomed={zId === p.id}
                          renameNonce={active && focus === p.id ? renameNonce : 0}
                          usage={p.engine ? usage[p.engine] : undefined}
                          index={i + 1}
                          area={zId === p.id ? FULL : areaById.get(p.id)}
                          onDragStart={active ? beginDrag : undefined}
                          onFocus={() => void (active && setFocus(p.id))}
                          onZoom={() => toggleZoomFor(w.id, zId, p.id)}
                        />
                      ))}
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
      <footer className="status">
<span className="ok">pqTERM {snap.user?.provider}</span>
        <span>{snap.user?.email}</span>
        <span>
          engines {detected} installed · {authed} auth
        </span>
        <span>
          {ws
            ? zoomedPane
              ? `zoom · ${zoomedPane.title}`
              : `${ws.layout}-grid`
            : 'idle'}
        </span>
        <span className="hint-keys">upuść na okno = zamień · upuść na ramkę = przytnij · ctrl+shift+[b panel / f zoom]</span>
      </footer>
      {modal === 'new' ? (
        <NewWorkspaceModal providers={snap.providers} onClose={() => setModal(null)} />
      ) : null}
      {modal === 'providers' ? (
        <ProvidersModal
          providers={snap.providers}
          email={snap.user?.email}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal === 'remote' ? <RemotePanel onClose={() => setModal(null)} /> : null}
    </>
  )
}