import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AppSnapshot, EngineId, LayoutId, PaneState, Workspace } from '@shared/types'
import { LAYOUTS } from '@shared/types'
import { RemoteClient } from './client'

const client = new RemoteClient()

export default function App() {
  const [phase, setPhase] = useState<'boot' | 'pin' | 'app'>('boot')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [snap, setSnap] = useState<AppSnapshot | null>(null)
  const [wsId, setWsId] = useState<string | null>(null)
  const [paneId, setPaneId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [line, setLine] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const s = await client.connect()
        if (!alive) return
        setSnap(s)
        setWsId(s.activeWorkspaceId)
        setPhase('app')
      } catch {
        if (alive) setPhase('pin')
      }
    })()
    client.onEvent = (msg) => {
      if (msg.e === 'state' && msg.snapshot) setSnap(msg.snapshot as AppSnapshot)
    }
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (phase !== 'app') return
    const onTerm = (msg: Record<string, unknown>) => {
      if (msg.e === 'term') {
        const id = String(msg.paneId || '')
        const data = String(msg.data || '')
        window.dispatchEvent(new CustomEvent('pq-term', { detail: { id, data } }))
      }
    }
    const prev = client.onEvent
    client.onEvent = (msg) => {
      prev?.(msg)
      onTerm(msg)
    }
    return () => {
      client.onEvent = prev
    }
  }, [phase])

  async function pair() {
    setErr('')
    try {
      await client.pair(pin)
      const s = await client.connect()
      setSnap(s)
      setWsId(s.activeWorkspaceId)
      setPhase('app')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const ws = snap?.workspaces.find((w) => w.id === wsId) ?? null
  const pane = ws?.panes.find((p) => p.id === paneId) ?? null

  if (phase === 'boot') {
    return (
      <div className="boot">
        <div className="brand">pq</div>
        connecting…
      </div>
    )
  }

  if (phase === 'pin') {
    return (
      <div className="boot">
        <div className="brand">pq</div>
        <p>Laptop jest źródłem. Wpisz PIN z pq na komputerze.</p>
        <input
          className="pin"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="PIN"
        />
        <button className="go" onClick={() => void pair()}>
          połącz
        </button>
        {err ? <div className="err">{err}</div> : null}
      </div>
    )
  }

  if (!snap) return null

  if (creating) {
    return (
      <CreateView
        snap={snap}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false)
          setWsId(id)
          setPaneId(null)
        }}
      />
    )
  }

  if (pane && ws) {
    return (
      <PaneView
        snap={snap}
        ws={ws}
        pane={pane}
        line={line}
        setLine={setLine}
        onBack={() => setPaneId(null)}
      />
    )
  }

  if (ws) {
    return (
      <div className="screen">
        <header>
          <button className="back" onClick={() => setWsId(null)}>
            ←
          </button>
          <div>
            <b>{ws.title}</b>
            <div className="sub">{ws.cwd}</div>
          </div>
        </header>
        <div className="list">
          {ws.panes.map((p, i) => (
            <button
              key={p.id}
              className="card"
              onClick={() => setPaneId(p.id)}
            >
              <span className="dot" style={{ background: color(snap, p.engine) }} />
              <span className="n">
                {i + 1} · {p.engine ? p.title : 'idle'}
              </span>
              <span className="meta">{p.engine || 'empty'}</span>
            </button>
          ))}
        </div>
        <div className="bar">
          <button
            className="go"
            onClick={() => {
              const eng =
                ws.panes.find((p) => p.engine)?.engine ||
                (snap.providers.find((p) => p.enabled && p.id !== 'shell')?.id ?? 'grok')
              void client.fill(eng)
            }}
          >
            fill rest
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <header>
        <div className="brand">pq</div>
        <div className="sub">{snap.user?.email || 'laptop'}</div>
      </header>
      <div className="list">
        {snap.workspaces.length === 0 ? (
          <div className="empty">brak workspace na laptopie.</div>
        ) : (
          snap.workspaces.map((w) => (
            <button
              key={w.id}
              className={w.id === snap.activeWorkspaceId ? 'card on' : 'card'}
              onClick={() => {
                setWsId(w.id)
                void client.select(w.id)
              }}
            >
              <span className="n">{w.title}</span>
              <span className="meta">
                {w.panes.filter((p) => p.engine).length}/{w.layout} · {w.cwd}
              </span>
            </button>
          ))
        )}
      </div>
      <div className="bar">
        <button className="go" onClick={() => setCreating(true)}>
          + workspace
        </button>
      </div>
    </div>
  )
}

function color(snap: AppSnapshot, engine: string | null): string {
  return snap.providers.find((p) => p.id === engine)?.color ?? '#4e5868'
}

function PaneView({
  snap,
  ws,
  pane,
  line,
  setLine,
  onBack
}: {
  snap: AppSnapshot
  ws: Workspace
  pane: PaneState
  line: string
  setLine: (s: string) => void
  onBack: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (!host.current || !pane.engine) return
    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'Cascadia Mono, Cascadia Code, Consolas, monospace',
      theme: { background: '#0b0d10', foreground: '#d6deea', cursor: '#39ffb6' },
      scrollback: 3000,
      convertEol: false
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    try {
      fit.fit()
    } catch {
      /* ignore */
    }
    termRef.current = term
    term.onData((d) => client.write(pane.id, d))
    const onEv = (e: Event) => {
      const d = (e as CustomEvent).detail as { id: string; data: string }
      if (d.id === pane.id) term.write(d.data)
    }
    window.addEventListener('pq-term', onEv)
    return () => {
      window.removeEventListener('pq-term', onEv)
      term.dispose()
      termRef.current = null
    }
  }, [pane.id, pane.engine])

  const enabled = snap.providers.filter((p) => p.enabled && p.id !== 'shell')

  return (
    <div className="screen term-screen">
      <header>
        <button className="back" onClick={onBack}>
          ←
        </button>
        <div>
          <b>{pane.engine ? pane.title : 'idle'}</b>
          <div className="sub">{ws.title}</div>
        </div>
      </header>
      {pane.engine ? (
        <div className="term" ref={host} />
      ) : (
        <div className="picker">
          {enabled.map((p) => (
            <button
              key={p.id}
              className="eng"
              disabled={!p.installed}
              onClick={() => client.setPane(ws.id, pane.id, { engine: p.id, title: p.name })}
            >
              <span style={{ color: p.color }}>{p.name}</span>
              <span className="meta">{p.vendor}</span>
            </button>
          ))}
        </div>
      )}
      <form
        className="compose"
        onSubmit={(e) => {
          e.preventDefault()
          if (!line.trim() || !pane.engine) return
          client.write(pane.id, line.trim() + '\r')
          setLine('')
        }}
      >
        <input
          value={line}
          onChange={(e) => setLine(e.target.value)}
          placeholder={pane.engine ? 'prompt → ten pane' : 'najpierw spawn'}
          disabled={!pane.engine}
        />
        <button type="submit" disabled={!pane.engine}>
          send
        </button>
      </form>
    </div>
  )
}

function CreateView({
  snap,
  onClose,
  onCreated
}: {
  snap: AppSnapshot
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [title, setTitle] = useState('')
  const [cwd, setCwd] = useState(snap.workspaces[0]?.cwd || '')
  const [layout, setLayout] = useState<LayoutId>(2)
  const [engines, setEngines] = useState<EngineId[]>([])
  const usable = snap.providers.filter((p) => p.enabled && p.id !== 'shell' && p.installed)

  return (
    <div className="screen">
      <header>
        <button className="back" onClick={onClose}>
          ←
        </button>
        <b>nowy workspace</b>
      </header>
      <div className="form">
        <label>tytuł</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
        <label>katalog na laptopie</label>
        <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="C:\Users\..." />
        <div className="cwds">
          {[...new Set(snap.workspaces.map((w) => w.cwd))].slice(0, 6).map((p) => (
            <button key={p} className="chip" onClick={() => setCwd(p)}>
              {p}
            </button>
          ))}
        </div>
        <label>grid</label>
        <div className="layouts">
          {LAYOUTS.map((n) => (
            <button key={n} className={layout === n ? 'on' : ''} onClick={() => setLayout(n)}>
              {n}
            </button>
          ))}
        </div>
        <label>silniki (jeden = wszystkie okna)</label>
        <div className="chips">
          {usable.map((p) => (
            <button
              key={p.id}
              className={engines.includes(p.id) ? 'chip on' : 'chip'}
              onClick={() =>
                setEngines((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id]))
              }
            >
              {p.name}
            </button>
          ))}
        </div>
        <button
          className="go"
          onClick={async () => {
            if (!title.trim() || !cwd.trim()) return
            const ws = (await client.create({
              title: title.trim(),
              cwd: cwd.trim(),
              layout,
              engines
            })) as { id?: string }
            onCreated(ws?.id || '')
          }}
        >
          utwórz na laptopie
        </button>
      </div>
    </div>
  )
}
