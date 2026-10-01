import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ACTIVITY_LABELS, isPaneWorking, type AppSnapshot, type BoardSnapshot, type PaneActivity, type Workspace } from '../../../shared/types'
import { moveId } from '../../../shared/order'
import EngineMark from './EngineMark'

/** Motion phase per row: eight evenly spaced steps inside one 1.5 s loop, so a
 *  list of busy rows reads as one travelling shimmer instead of N blinkers. */
function phase(i: number): CSSProperties {
  return { '--phase': i % 8 } as CSSProperties
}

export default function Sidebar({
  snap,
  activity,
  onNew,
  onEdit,
  focusPane
}: {
  snap: AppSnapshot
  activity: Record<string, PaneActivity>
  onNew: () => void
  onEdit: (workspaceId: string) => void
  focusPane: (workspaceId: string, paneId: string) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [board, setBoard] = useState<BoardSnapshot | null>(null)
  const [selectError, setSelectError] = useState('')
  const [folderError, setFolderError] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; place: 'before' | 'after' } | null>(null)
  const draggedRef = useRef(false)
  const searching = q.trim().length > 0

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
  // How many panes work at once across the whole list — drives the motion ramp:
  // many busy rows mean the shimmer says nothing, so it stops (styles.css
  // `.ws-list.busy-3`) and the shapes alone carry the state.
  const busy = useMemo(
    () => list.reduce((n, w) => n + w.panes.filter((p) => isPaneWorking(p, activity)).length, 0),
    [list, activity]
  )

  function providerFor(engine: string | null) {
    return snap.providers.find((p) => p.id === engine)
  }

  async function select(w: Workspace, paneId?: string) {
    if (draggedRef.current) return
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
      <div
        className={`ws-list${busy === 0 ? '' : busy < 3 ? ` busy-${busy}` : ' busy-3'}`}
        title={searching ? undefined : 'przeciągnij, żeby zamienić kolejność'}
      >
        {list.length === 0 ? (
          <div className="empty-side">
            brak workspace.
            <br />
            utwórz pierwszy — nadaj tytuł pracy, którą chcesz odwalić z agentami.
          </div>
        ) : (
          list.map((w, wi) => {
            const expanded = open[w.id] ?? w.id === snap.activeWorkspaceId
            const live = w.panes.filter((p) => p.engine).length
            const unread = w.panes.filter((p) => activity[p.id]?.unread).length
            const working = w.panes.filter((p) => isPaneWorking(p, activity)).length
            const dropClass = drop && drop.id === w.id ? ` drop-${drop.place}` : ''
            return (
              <div
                key={w.id}
                className={`${w.id === snap.activeWorkspaceId ? 'ws active' : 'ws'}${
                  draggingId === w.id ? ' dragging' : ''
                }${!searching ? ' movable' : ''}${working ? ' busy' : ''}${dropClass}`}
                style={phase(wi)}
                draggable={!searching}
                onDragStart={(e) => {
                  if (searching || (e.target as HTMLElement).closest('button')) {
                    e.preventDefault()
                    return
                  }
                  draggedRef.current = true
                  e.dataTransfer.setData('text/plain', `pq-ws:${w.id}`)
                  e.dataTransfer.effectAllowed = 'move'
                  setDraggingId(w.id)
                }}
                onDragEnd={() => {
                  setDraggingId(null)
                  setDrop(null)
                  queueMicrotask(() => { draggedRef.current = false })
                }}
                onDragOver={(e) => {
                  if (!draggedRef.current || searching) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const rect = e.currentTarget.getBoundingClientRect()
                  const place = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                  if (drop?.id !== w.id || drop.place !== place) setDrop({ id: w.id, place })
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const raw = e.dataTransfer.getData('text/plain')
                  const fromId = raw.startsWith('pq-ws:') ? raw.slice(6) : ''
                  const place = drop?.id === w.id ? drop.place : 'before'
                  setDraggingId(null)
                  setDrop(null)
                  if (!fromId || searching) return
                  const next = moveId(snap.workspaces.map((item) => item.id), fromId, w.id, place)
                  if (next.some((id, i) => id !== snap.workspaces[i]?.id)) {
                    void window.pq.workspaces.reorder(next)
                  }
                }}
              >
                <div
                  className="row"
                  onClick={() => select(w)}
                  onDoubleClick={(e) => {
                    // Not on the row's action buttons (chev/remove/folder).
                    if ((e.target as HTMLElement).closest('button, .chev')) return
                    e.stopPropagation()
                    onEdit(w.id)
                  }}
                  title="klik: otwórz · dwuklik: edytuj (nazwa, katalog, grid)"
                >
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
                  <span className="meta" title={working ? `${working} z ${live} okien pracuje teraz` : undefined}>
                    {live}/{w.layout}
                  </span>
                  <button
                    className="iconx ws-gear"
                    title={`ustawienia „${w.title}” — nazwa, katalog, liczba okien (dwuklik też otwiera)`}
                    aria-label={`ustawienia workspace ${w.title}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(w.id)
                    }}
                  >
                    ⚙
                  </button>
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
                  w.panes.map((p, pi) => (
                    <div
                      key={p.id}
                      className={`${p.engine ? 'pane-link' : 'pane-link idle'}${
                        w.zoomedPaneId === p.id ? ' zoomed' : ''
                      }${activity[p.id]?.unread ? ' unread' : ''}${isPaneWorking(p, activity) ? ' busy' : ''}`}
                      style={phase(pi)}
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
                      <button
                        className="iconx side-remove"
                        title={`zamknij okno ${p.title} — sesja zostanie zakończona`}
                        aria-label={`zamknij okno ${p.title}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          void window.pq.workspaces.removePane(w.id, p.id)
                        }}
                      >
                        ×
                      </button>
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
