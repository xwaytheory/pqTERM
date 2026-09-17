import { useEffect, useMemo, useState } from 'react'
import { ACTIVITY_LABELS, type AppSnapshot, type BoardSnapshot, type PaneActivity, type Workspace } from '../../../shared/types'
import EngineMark from './EngineMark'

export default function Sidebar({
  snap,
  activity,
  onNew,
  focusPane
}: {
  snap: AppSnapshot
  activity: Record<string, PaneActivity>
  onNew: () => void
  focusPane: (workspaceId: string, paneId: string) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [board, setBoard] = useState<BoardSnapshot | null>(null)
  const [selectError, setSelectError] = useState('')
  const [folderError, setFolderError] = useState('')

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

  async function select(w: Workspace, paneId?: string) {
    try {
      await window.pq.workspaces.select(w.id)
      setOpen((o) => ({ ...o, [w.id]: true }))
      setSelectError('')
      if (paneId) focusPane(w.id, paneId)
    } catch (error) {
      console.error('[pqTERM] workspace selection failed', error)
      setSelectError('Nie udało się otworzyć workspace.')
    }
  }

  async function openFolder(w: Workspace) {
    setFolderError('')
    try {
      await window.pq.workspaces.openFolder(w.id)
    } catch (error) {
      console.error('[pqTERM] workspace folder failed', error)
      setFolderError(`Nie udało się otworzyć folderu projektu „${w.title}”. Sprawdź, czy katalog istnieje i jest dostępny.`)
    }
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
            const unread = w.panes.filter((p) => activity[p.id]?.unread).length
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
                  {unread ? <span className="activity-count" title={`${unread} nieprzeczytanych statusów`} aria-label={`${unread} nieprzeczytanych statusów`}>{unread}</span> : null}
                  <span className="meta">
                    {live}/{w.layout}
                  </span>
                  <button
                    className="iconx side-remove"
                    title={`usuń projekt ${w.title}`}
                    aria-label={`usuń projekt ${w.title}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (window.confirm(`Usunąć projekt „${w.title}” z pqTERM i zamknąć wszystkie jego sesje CLI? Pliki na dysku pozostaną bez zmian.`)) {
                        void window.pq.workspaces.remove(w.id)
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="cwd">
                  <button
                    className="iconx folder-open"
                    title={`Otwórz folder projektu: ${w.cwd}`}
                    aria-label={`Otwórz folder projektu ${w.title}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void openFolder(w)
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />
                    </svg>
                  </button>
                  <span title={w.cwd}>{w.cwd}</span>
                </div>
                {expanded &&
                  w.panes.map((p) => (
                    <div
                      key={p.id}
                      className={`${p.engine ? 'pane-link' : 'pane-link idle'}${
                        w.zoomedPaneId === p.id ? ' zoomed' : ''
                      }${activity[p.id]?.unread ? ' unread' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => void select(w, p.id)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
                        e.preventDefault()
                        void select(w, p.id)
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
                            size={16}
                          />
                        )
                      })()}
                      <span className="pane-label">
                        {p.engine ? p.title : 'idle'}
                        {p.model ? ` · ${p.model}` : ''}
                      {activity[p.id] ? (
                        <span
                          className={`activity-badge activity-${activity[p.id].kind}${activity[p.id].unread ? ' unread' : ''}`}
                          title={`${ACTIVITY_LABELS[activity[p.id].kind]}${activity[p.id].unread ? ' · nieprzeczytane' : ''}`}
                          aria-label={`${ACTIVITY_LABELS[activity[p.id].kind]}${activity[p.id].unread ? ' · nieprzeczytane' : ''}`}
                        >
                          {ACTIVITY_LABELS[activity[p.id].kind]}
                        </span>
                      ) : null}
                      </span>
                      {p.engine ? (
                        <button
                          className="iconx side-remove"
                          title={`zamknij sesję ${p.title}`}
                          aria-label={`zamknij sesję ${p.title}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            void window.pq.terminals.clearPane(w.id, p.id)
                          }}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  ))}
              </div>
            )
          })
        )}
      </div>
      {selectError ? <div className="empty-side" role="status">{selectError}</div> : null}
      {folderError ? <div className="empty-side" role="alert">{folderError}</div> : null}
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
