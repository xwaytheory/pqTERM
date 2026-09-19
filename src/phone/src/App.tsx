import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AppSnapshot, EngineId, LayoutId, PaneState, Workspace } from '@shared/types'
import { isRawShell, LAYOUTS } from '@shared/types'
import { RemoteClient } from './client'
import { attachPqSttGlue, isNativePqStt, startPqSttListen, stopPqSttListen } from './pqSttGlue'

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
  const [connected, setConnected] = useState(false)
  const pairing = useRef<AbortController | null>(null)

  useEffect(() => {
    let alive = true
    client.onEvent = (msg) => {
      if (msg.e === 'connection') setConnected(msg.ready === true)
      if (msg.e === 'state' && msg.snapshot) {
        setSnap(msg.snapshot as AppSnapshot)
        setPhase('app')
      }
      if (msg.e === 'term') {
        const id = String(msg.paneId || '')
        const data = String(msg.data || '')
        window.dispatchEvent(new CustomEvent('pq-term', { detail: { id, data } }))
      }
    }
    void client.connect().then((s) => {
      if (!alive) return
      setSnap(s)
      setWsId(s.activeWorkspaceId)
      setPhase('app')
    }).catch(() => {
      if (alive) setPhase('pin')
    })
    return () => {
      alive = false
      pairing.current?.abort()
      client.onEvent = null
      client.disconnect()
    }
  }, [])

  async function pair() {
    if (pairing.current) return
    const controller = new AbortController()
    pairing.current = controller
    setErr('')
    try {
      const token = await client.pair(pin, controller.signal)
      if (controller.signal.aborted) return
      const s = await client.connect(token)
      if (controller.signal.aborted) return
      setSnap(s)
      setWsId(s.activeWorkspaceId)
      setPhase('app')
    } catch (e) {
      if (!controller.signal.aborted) setErr(e instanceof Error ? e.message : String(e))
    } finally {
      if (pairing.current === controller) pairing.current = null
    }
  }

  const ws = snap?.workspaces.find((w) => w.id === wsId) ?? null
  const pane = ws?.panes.find((p) => p.id === paneId) ?? null

  if (phase === 'boot') {
    return (
      <div className="boot">
        <div className="brand">pqTERM</div>
        connecting…
      </div>
    )
  }

  if (phase === 'pin') {
    return (
      <div className="boot">
        <div className="brand">pqTERM</div>
        <p>Wpisz PIN z panelu TELEFON. Zobaczysz te same workspace’y co na laptopie.</p>
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
        connected={connected}
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
        {!connected ? <div role="status">offline — brak wysyłania</div> : null}
        {err ? <div className="err" role="alert">{err}</div> : null}
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
                (snap.providers.find((p) => p.enabled && !isRawShell(p.id))?.id ?? 'grok')
              setErr('')
              void client.fill(ws.id, eng).catch((e: Error) => setErr(e.message))
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
        <div className="brand">pqTERM</div>
        <div className="sub">{snap.user?.email || 'laptop'}</div>
      </header>
      {!connected ? <div role="status">offline — brak wysyłania</div> : null}
      {err ? <div className="err" role="alert">{err}</div> : null}
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
                setErr('')
                void client.select(w.id).catch((e: Error) => setErr(e.message))
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
  connected,
  onBack
}: {
  snap: AppSnapshot
  ws: Workspace
  pane: PaneState
  line: string
  setLine: Dispatch<SetStateAction<string>>
  connected: boolean
  onBack: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const [sttHint, setSttHint] = useState('')
  const [sttListening, setSttListening] = useState(false)
  const [sendError, setSendError] = useState('')
  const nativeStt = isNativePqStt()

  // Mic → PqStt → same WS write path as typed compose (Android WebView only).
  useEffect(() => {
    if (!pane.engine) return
    const dispose = attachPqSttGlue({
      sendCommand: (text) => {
        if (!client.write(pane.id, text.trim() + '\r')) {
          setLine((previous) => previous ? `${previous} ${text.trim()}` : text.trim())
          setSendError('Nie wysłano — tekst zachowany. Po połączeniu naciśnij send.')
        } else {
          setSendError('')
        }
        setSttListening(false)
        setSttHint('')
      },
      onPartial: (t) => setSttHint(t),
      onError: (m) => {
        setSttListening(false)
        setSttHint(m)
      },
      onStatus: (s) => {
        const live = s === 'listening' || s === 'ready' || s === 'speech' || s === 'processing'
        setSttListening(live)
        if (s === 'idle' || s === 'cancelled') setSttHint('')
      }
    })
    return dispose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id, pane.engine])

  useEffect(() => {
    if (!host.current || !pane.engine) return
    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'Cascadia Mono, Cascadia Code, Consolas, monospace',
      theme: { background: '#0b0d10', foreground: '#d6deea', cursor: '#39ffb6' },
      scrollback: 3000,
      convertEol: false,
      // Same ConPTY stream as the desktop grid — same heuristics needed.
      windowsPty: { backend: 'conpty' }
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
    term.onData((d) => {
      if (!client.write(pane.id, d)) setSendError('Offline — wpisuj w polu prompt, aby zachować tekst.')
    })
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

  const enabled = snap.providers.filter((p) => p.enabled && !isRawShell(p.id))

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
      {!connected ? <div role="status">offline — brak wysyłania</div> : null}
      {sendError ? <div className="err" role="alert">{sendError}</div> : null}
      {pane.engine ? (
        <div className="term" ref={host} />
      ) : (
        <div className="picker">
          {enabled.map((p) => (
            <button
              key={p.id}
              className="eng"
              disabled={!p.installed}
              onClick={() => {
                setSendError('')
                void client.setPane(ws.id, pane.id, { engine: p.id, title: p.name })
                  .catch((e: Error) => setSendError(e.message))
              }}
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
          if (client.write(pane.id, line.trim() + '\r')) {
            setLine('')
            setSendError('')
          } else {
            setSendError('Nie wysłano — tekst zachowany. Po połączeniu naciśnij send.')
          }
        }}
      >
        <input
          value={line}
          onChange={(e) => setLine(e.target.value)}
          placeholder={pane.engine ? (sttHint || 'prompt / mic') : 'najpierw spawn'}
          disabled={!pane.engine}
        />
        {nativeStt && pane.engine ? (
          <button
            type="button"
            className={sttListening ? 'mic on' : 'mic'}
            title="mowa (SpeechRecognizer)"
            onClick={() => {
              if (sttListening) {
                stopPqSttListen()
                setSttListening(false)
              } else {
                setSttHint('')
                if (!startPqSttListen()) setSttHint('brak mostu PqStt')
              }
            }}
          >
            {sttListening ? '…' : 'mic'}
          </button>
        ) : null}
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
  const [error, setError] = useState('')
  const usable = snap.providers.filter((p) => p.enabled && !isRawShell(p.id) && p.installed)

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
            setError('')
            try {
              const ws = (await client.create({
                title: title.trim(),
                cwd: cwd.trim(),
                layout,
                engines
              })) as { id?: string }
              onCreated(ws?.id || '')
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        >
          utwórz na laptopie
        </button>
        {error ? <div className="err" role="alert">{error}</div> : null}
      </div>
    </div>
  )
}
