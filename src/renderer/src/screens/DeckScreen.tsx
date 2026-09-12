import { useEffect, useMemo, useState } from 'react'
import type { AppSnapshot, EngineId, LayoutId, UsageMap } from '../../../shared/types'
import { LAYOUTS } from '../../../shared/types'
import Titlebar from '../components/Titlebar'
import Sidebar from '../components/Sidebar'
import TerminalPane from '../components/TerminalPane'
import NewWorkspaceModal from '../components/NewWorkspaceModal'
import ProvidersModal from '../components/ProvidersModal'
import RemotePanel from '../components/RemotePanel'
import VoicePanel from '../components/VoicePanel'

export default function DeckScreen({ snap }: { snap: AppSnapshot }) {
  const [modal, setModal] = useState<'new' | 'providers' | 'remote' | 'voice' | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [renameNonce, setRenameNonce] = useState(0)
  const [usage, setUsage] = useState<UsageMap>({})
  const [cast, setCast] = useState('')
  const ws = snap.workspaces.find((w) => w.id === snap.activeWorkspaceId) ?? null
  const detected = snap.providers.filter((p) => p.installed && p.id !== 'shell').length
  const authed = snap.providers.filter((p) => p.detectedAuth && p.id !== 'shell').length
  const zoomedId = ws?.zoomedPaneId ?? null
  const zoomedPane = ws?.panes.find((p) => p.id === zoomedId) ?? null

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
          <button className="dockbtn" title="mowa / asystent głosowy" onClick={() => setModal('voice')}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="9" y="2.5" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <line x1="12" y1="18" x2="12" y2="21.5" />
            </svg>
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
                        title="pq wyśle ten prompt do wszystkich okien tego silnika; puste od razu odpali"
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
              {snap.workspaces.map((w) => {
                const active = w.id === snap.activeWorkspaceId
                const zId = w.zoomedPaneId ?? null
                return (
                  <div key={w.id} className={`ws-grid${active ? ' active' : ''}`}>
                    <div className={`grid l${w.layout}${zId ? ' zoomed' : ''}`}>
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
        <span className="ok">pq {snap.user?.provider}</span>
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
        <span className="hint-keys">fill rest · broadcast · ctrl+shift+f zoom</span>
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
      {modal === 'voice' ? (
        <VoicePanel snap={snap} focus={focus} onClose={() => setModal(null)} />
      ) : null}
    </>
  )
}
