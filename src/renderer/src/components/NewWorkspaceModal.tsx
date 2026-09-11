import { useState } from 'react'
import type { EngineId, LayoutId, ProviderInfo } from '../../../shared/types'
import { LAYOUTS } from '../../../shared/types'

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

  const usable = providers.filter((p) => p.id !== 'shell' && p.enabled)

  function toggle(id: EngineId) {
    setEngines((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      if (cur.length >= layout) return cur
      return [...cur, id]
    })
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
        <label className="f">START ENGINES ({engines.length}/{layout})</label>
        <div className="chips">
          {usable.map((p) => (
            <button
              key={p.id}
              className={engines.includes(p.id) ? 'chip on' : 'chip'}
              disabled={!p.installed}
              onClick={() => toggle(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        {err ? <div className="err">{err}</div> : null}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            cancel
          </button>
          <button className="primary" style={{ width: 'auto', padding: '0 18px', marginTop: 0 }} onClick={create}>
            create
          </button>
        </div>
      </div>
    </div>
  )
}
