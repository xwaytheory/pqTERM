import { useState } from 'react'
import type { EngineId, LayoutId, ProviderInfo } from '../../../shared/types'
import { isRawShell, LAYOUTS } from '../../../shared/types'
import EngineMark from './EngineMark'
import EngineActions, { EngineFeedback, useEngineActions } from './EngineActions'

export default function NewWorkspaceModal({
  providers,
  onClose
}: {
  providers: ProviderInfo[]
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [cwd, setCwd] = useState('')
  const [layout, setLayout] = useState<LayoutId>(2)
  const [engines, setEngines] = useState<EngineId[]>([])
  const [err, setErr] = useState('')
  const actions = useEngineActions()

  const usable = providers.filter((p) => !isRawShell(p.id) && p.enabled)
  const selected = engines.filter((id) => usable.some((p) => p.id === id && p.installed))
  const missing = providers.filter((p) => !isRawShell(p.id) && !p.installed)

  function toggle(id: EngineId) {
    setEngines((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  async function pick() {
    try {
      const folder = await window.pq.workspaces.pickFolder()
      if (folder) setCwd(folder)
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error))
    }
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
    try {
      await window.pq.workspaces.create({
        title: title.trim(),
        cwd: cwd.trim(),
        layout,
        engines: selected
      })
      onClose()
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>NEW WORKSPACE</h2>
        <div className="sub">tytuł = zadanie. katalog = cwd dla każdego terminala w gridzie.</div>
        <label className="f">TYTUŁ</label>
        <input
          className="f"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="np. refactor auth · trading bot · docs rewrite"
          autoFocus
        />
        <label className="f">KATALOG</label>
        <div className="row2">
          <input className="f" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="C:\…" />
          <button className="ghost" onClick={pick}>
            browse
          </button>
        </div>
        <label className="f">GRID</label>
        <div className="layouts">
          {LAYOUTS.map((n) => (
            <button key={n} className={layout === n ? 'on' : ''} onClick={() => setLayout(n)}>
              {n}
            </button>
          ))}
        </div>
        <label className="f">SILNIKI NA START</label>
        <div className="sub" style={{ marginTop: -8 }}>
          jeden silnik = wszystkie {layout} okna. kilka silników = rozłożą się w kółko.
        </div>
        <div className="chips">
          {usable.map((p) => (
            <button
              key={p.id}
              className={selected.includes(p.id) ? 'chip on' : 'chip'}
              disabled={!p.installed || !!actions.pending}
              onClick={() => toggle(p.id)}
            >
              <EngineMark id={p.id} name={p.name} color={p.color} logo={p.logo} icon={p.icon} mark={p.mark} size={26} />
              {p.name}
            </button>
          ))}
        </div>
        <EngineFeedback actions={actions} />
        {missing.length > 0 && (
          <details className="workspace-cli">
            <summary>install missing CLI ({missing.length})</summary>
            <div className="hint">Instalacja nie wybiera silnika automatycznie. Po instalacji wybierz go powyżej; wyłączone silniki włącz w Providers.</div>
            {missing.map((p) => (
              <div className="workspace-cli-row" key={p.id}>
                <b style={{ color: p.color }}>{p.name}</b>
                <EngineActions provider={p} actions={actions} />
              </div>
            ))}
          </details>
        )}
        {selected.length ? (
          <div className="hint" style={{ marginTop: 8 }}>
            {Array.from({ length: layout }, (_, i) => {
              const id = selected[i % selected.length]
              return usable.find((p) => p.id === id)?.name ?? id
            }).join(' · ')}
          </div>
        ) : (
          <div className="hint" style={{ marginTop: 8 }}>
            bez wyboru — {layout} puste sloty, silnik klikasz w pane.
          </div>
        )}
        {err ? <div className="err" role="status" aria-live="polite">{err}</div> : null}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            cancel
          </button>
          <button className="primary" disabled={!!actions.pending} style={{ width: 'auto', padding: '0 18px', marginTop: 0 }} onClick={create}>
            create
          </button>
        </div>
      </div>
    </div>
  )
}
