import { useEffect, useRef, useState } from 'react'
import type { EngineId, LayoutId, ProviderInfo, Workspace } from '../../../shared/types'
import { isRawShell, MAX_PANES } from '../../../shared/types'
import { defaultAreas } from '../../../shared/grid'
import EngineMark from './EngineMark'

const GRID_CHOICES = Array.from({ length: MAX_PANES }, (_, i) => (i + 1) as LayoutId)

function LayoutGlyph({ n }: { n: number }) {
  return (
    <span className="layout-glyph" aria-hidden>
      {defaultAreas(n).map((cell, i) => (
        <i
          key={i}
          style={{
            left: `calc(${cell.x * 100}% + 1px)`,
            top: `calc(${cell.y * 100}% + 1px)`,
            width: `calc(${cell.w * 100}% - 2px)`,
            height: `calc(${cell.h * 100}% - 2px)`
          }}
        />
      ))}
    </span>
  )
}

export default function NewWorkspaceModal({
  providers,
  workspace,
  onClose
}: {
  providers: ProviderInfo[]
  /** Present → edit this workspace (name/cwd/grid) instead of creating one. */
  workspace?: Workspace
  onClose: () => void
}) {
  const editing = workspace !== undefined
  const titleRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(workspace?.title ?? '')
  const [cwd, setCwd] = useState(workspace?.cwd ?? '')
  const [layout, setLayout] = useState<LayoutId>(workspace?.layout ?? 2)
  const [engines, setEngines] = useState<EngineId[]>([])
  const [err, setErr] = useState('')

  const usable = providers.filter((p) => !isRawShell(p.id) && p.enabled)
  const liveEngines = workspace?.panes.filter((p) => p.engine).length ?? 0

  useEffect(() => {
    const id = window.setTimeout(() => titleRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [])

  function toggle(id: EngineId) {
    setEngines((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  async function pick() {
    const folder = await window.pq.workspaces.pickFolder()
    if (folder) setCwd(folder)
  }

  async function create() {
    setErr('')
    if (!title.trim()) {
      setErr('nadaj tytuł — to nazwa pracy, nie folderu.')
      return
    }
    if (!cwd.trim()) {
      setErr('wybierz katalog projektu.')
      return
    }
    await window.pq.workspaces.create({
      title: title.trim(),
      cwd: cwd.trim(),
      layout,
      engines
    })
    onClose()
  }

  async function save() {
    setErr('')
    if (!workspace) return
    if (!title.trim()) {
      setErr('nadaj tytuł — to nazwa pracy, nie folderu.')
      return
    }
    if (!cwd.trim()) {
      setErr('wybierz katalog projektu.')
      return
    }
    if (layout < workspace.layout && liveEngines > layout) {
      const ok = window.confirm(
        `Zmniejszasz grid z ${workspace.layout} do ${layout} okien — zamknie to ${liveEngines - layout} działających sesji CLI. Kontynuować?`
      )
      if (!ok) return
    }
    await window.pq.workspaces.update(workspace.id, { title: title.trim(), cwd: cwd.trim() })
    if (layout !== workspace.layout) {
      await window.pq.workspaces.setLayout(workspace.id, layout)
    }
    onClose()
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? 'EDIT WORKSPACE' : 'NEW WORKSPACE'}</h2>
        <div className="sub">
          {editing
            ? 'zmień nazwę, katalog albo liczbę okien. sesje żyją, dopóki mieszczą się w gridzie.'
            : 'tytuł = zadanie. katalog = cwd dla każdego terminala w gridzie.'}
        </div>
        <label className="f">TYTUŁ</label>
        <input
          ref={titleRef}
          className="f"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onMouseDown={(e) => e.currentTarget.focus()}
          placeholder="np. refactor auth · trading bot · docs rewrite"
        />
        <label className="f">KATALOG</label>
        <div className="row2">
          <input
            className="f"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            onMouseDown={(e) => e.currentTarget.focus()}
            placeholder="C:\…"
          />
          <button className="ghost" onClick={pick}>
            browse
          </button>
        </div>
        <label className="f">GRID</label>
        <div className="layouts" role="listbox" aria-label="układ okien">
          {GRID_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={layout === n}
              aria-label={n === 1 ? '1 okno' : `${n} okien`}
              title={n === 1 ? '1 okno' : `${n} okien`}
              className={layout === n ? 'on' : ''}
              onClick={() => setLayout(n)}
            >
              <LayoutGlyph n={n} />
              <span className="layout-n">{n}</span>
            </button>
          ))}
        </div>
        {!editing ? (
          <>
            <label className="f">SILNIKI NA START</label>
            <div className="sub" style={{ marginTop: -8 }}>
              jeden silnik = wszystkie {layout} okna. kilka silników = rozłożą się w kółko.
            </div>
            <div className="chips">
              {usable.map((p) => (
                <button
                  key={p.id}
                  className={engines.includes(p.id) ? 'chip on' : 'chip'}
                  disabled={!p.installed}
                  onClick={() => toggle(p.id)}
                >
                  <EngineMark id={p.id} name={p.name} color={p.color} logo={p.logo} icon={p.icon} mark={p.mark} size={26} />
                  {p.name}
                </button>
              ))}
            </div>
            {engines.length ? (
              <div className="hint" style={{ marginTop: 8 }}>
                {Array.from({ length: layout }, (_, i) => {
                  const id = engines[i % engines.length]
                  return usable.find((p) => p.id === id)?.name ?? id
                }).join(' · ')}
              </div>
            ) : (
              <div className="hint" style={{ marginTop: 8 }}>
                bez wyboru — {layout} puste sloty, silnik klikasz w pane.
              </div>
            )}
          </>
        ) : null}
        {err ? <div className="err">{err}</div> : null}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            cancel
          </button>
          <button
            className="primary"
            style={{ width: 'auto', padding: '0 18px', marginTop: 0 }}
            onClick={editing ? save : create}
          >
            {editing ? 'save' : 'create'}
          </button>
        </div>
      </div>
    </div>
  )
}
