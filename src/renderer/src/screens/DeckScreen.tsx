import { useMemo, useState } from 'react'
import type { AppSnapshot, LayoutId } from '../../../shared/types'
import { LAYOUTS } from '../../../shared/types'
import Titlebar from '../components/Titlebar'
import Sidebar from '../components/Sidebar'
import TerminalPane from '../components/TerminalPane'
import NewWorkspaceModal from '../components/NewWorkspaceModal'
import ProvidersModal from '../components/ProvidersModal'

export default function DeckScreen({ snap }: { snap: AppSnapshot }) {
  const [modal, setModal] = useState<'new' | 'providers' | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const ws = snap.workspaces.find((w) => w.id === snap.activeWorkspaceId) ?? null
  const detected = snap.providers.filter((p) => p.installed && p.id !== 'shell').length
  const authed = snap.providers.filter((p) => p.detectedAuth && p.id !== 'shell').length

  const center = useMemo(() => {
    if (!ws) return 'no workspace'
    return (
      <>
        workspace · <b>{ws.title}</b>
      </>
    )
  }, [ws])

  return (
    <>
      <Titlebar center={center} />
      <div className="deck">
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
        <Sidebar snap={snap} onNew={() => setModal('new')} focusPane={(_w, paneId) => setFocus(paneId)} />
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
                <span className="path" title={ws.cwd}>
                  {ws.cwd}
                </span>
                <div className="grow" />
                <button className="ghost" onClick={() => window.pq.workspaces.remove(ws.id)}>
                  delete ws
                </button>
              </div>
              <div className={`grid l${ws.layout}`}>
                {ws.panes.map((p) => (
                  <TerminalPane
                    key={p.id}
                    pane={p}
                    workspaceId={ws.id}
                    cwd={ws.cwd}
                    providers={snap.providers}
                    focused={focus === p.id}
                    onFocus={() => setFocus(p.id)}
                  />
                ))}
              </div>
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
        <span>{ws ? `${ws.layout}-grid` : 'idle'}</span>
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
    </>
  )
}
