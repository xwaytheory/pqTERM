import { useEffect, useMemo, useState } from 'react'
import type { AppSnapshot, BoardSnapshot, Workspace } from '../../../shared/types'
import EngineMark from './EngineMark'

export default function Sidebar({
  snap,
  onNew,
  focusPane
}: {
  snap: AppSnapshot
  onNew: () => void
  focusPane: (workspaceId: string, paneId: string) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [board, setBoard] = useState<BoardSnapshot | null>(null)

  useEffect(() => {
    let off: (() => void) | undefined
    void window.pq.board.get().then(setBoard)
    off = window.pq.board.onChange(setBoard)
    return () => off?.()
  }, [])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return snap.workspaces
    return snap.workspaces.filter(
      (w) =>
        w.title.toLowerCase().includes(s) ||
        w.cwd.toLowerCase().includes(s) ||
        w.panes.some((p) => p.title.toLowerCase().includes(s))
    )
  }, [q, snap.workspaces])

  function providerFor(engine: string | null) {
    return snap.providers.find((p) => p.id === engine)
  }

  async function select(w: Workspace) {
    await window.pq.workspaces.select(w.id)
    setOpen((o) => ({ ...o, [w.id]: true }))
  }

  return (
    <aside className={snap.sidebarOpen ? 'sidebar' : 'sidebar collapsed'}>
      <div className="side-head">
        <span>WORKSPACES</span>
        <button className="nodrag" onClick={onNew}>
          + new
        </button>
      </div>
      <input
        className="search"
        placeholder="szukaj workspace / pane…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="ws-list">
        {list.length === 0 ? (
          <div className="empty-side">
            brak workspace.
            <br />
            utwórz pierwszy — nadaj tytuł pracy, którą chcesz odwalić z agentami.
          </div>
        ) : (
          list.map((w) => {
            const expanded = open[w.id] ?? w.id === snap.activeWorkspaceId
            const live = w.panes.filter((p) => p.engine).length
            return (
              <div key={w.id} className={w.id === snap.activeWorkspaceId ? 'ws active' : 'ws'}>
                <div className="row" onClick={() => select(w)}>
                  <span
                    className="chev"
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpen((o) => ({ ...o, [w.id]: !expanded }))
                    }}
                  >
                    {expanded ? '▾' : '▸'}
                  </span>
                  <span className="name">{w.title}</span>
                  <span className="meta">
                    {live}/{w.layout}
                  </span>
                </div>
                <div className="cwd" title={w.cwd}>
                  {w.cwd}
                </div>
                {expanded &&
                  w.panes.map((p) => (
                    <div
                      key={p.id}
                      className={`${p.engine ? 'pane-link' : 'pane-link idle'}${
                        w.zoomedPaneId === p.id ? ' zoomed' : ''
                      }`}
                      onClick={() => {
                        select(w)
                        focusPane(w.id, p.id)
                      }}
                    >
                      {(() => {
                        const prov = providerFor(p.engine)
                        return (
                          <EngineMark
                            id={p.engine ?? undefined}
                            name={prov?.name ?? (p.engine ? p.title : 'idle')}
                            color={prov?.color ?? '#4e5868'}
                            logo={prov?.logo}
                            icon={prov?.icon}
                            mark={prov?.mark}
                            size={14}
                          />
                        )
                      })()}
                      <span>
                        {p.engine ? p.title : 'idle'}
                        {p.model ? ` · ${p.model}` : ''}
                      </span>
                    </div>
                  ))}
              </div>
            )
          })
        )}
      </div>
      {board && board.notes.length ? (
        <div className="coord">
          <div className="side-head">
            <span>COORD</span>
            <span className="meta">
              {board.notes.filter((n) => n.relation === 'overlap').length} overlap
            </span>
          </div>
          {board.notes.slice(0, 5).map((n, i) => (
            <div key={i} className={`coord-note ${n.relation}`}>
              <b>{n.relation}</b> {n.detail}
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  )
}
