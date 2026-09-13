import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import {
  clipTitle,
  isDefaultPaneTitle,
  parseGridIntent,
  type EngineId,
  type EngineUsage,
  type PaneArea,
  type PaneState,
  type ProviderInfo
} from '../../../shared/types'
import { areaStyle } from '../../../shared/grid'
import { formatDroppedPaths, pathShellForPane } from '../lib/dropPaths'
import EngineMark from './EngineMark'

function resetLeft(ms?: number): string {
  if (!ms) return ''
  const d = ms - Date.now()
  if (d <= 0) return 'soon'
  const m = Math.round(d / 60000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

function UsageChip({ usage }: { usage: EngineUsage }) {
  if (!usage.windows.length) return null
  return (
    <span className="usage">
      {usage.windows.slice(0, 2).map((w) => {
        const pct = Math.max(0, Math.min(100, Math.round(w.usedPct)))
        const filled = Math.round((pct / 100) * 7)
        const bar = '▮'.repeat(filled) + '▯'.repeat(7 - filled)
        const tone = pct >= 90 ? 'hot' : pct >= 70 ? 'warm' : 'ok'
        const left = resetLeft(w.resetAt)
        return (
          <span
            key={w.id}
            className={`uchip ${tone}`}
            title={`${usage.plan ? usage.plan + ' · ' : ''}${w.label} ${pct}% used${left ? ' · reset ' + left : ''}`}
          >
            <span className="ubar">{bar}</span>
            <span className="upct">{pct}%</span>
            <span className="ulbl">{w.label}</span>
          </span>
        )
      })}
    </span>
  )
}

export default function TerminalPane({
  pane,
  workspaceId,
  cwd,
  providers,
  focused,
  zoomed,
  renameNonce,
  usage,
  index,
  area,
  onFocus,
  onZoom,
  onDragStart
}: {
  pane: PaneState
  workspaceId: string
  cwd: string
  providers: ProviderInfo[]
  focused: boolean
  zoomed: boolean
  renameNonce: number
  usage?: EngineUsage
  index: number
  area?: PaneArea
  onFocus: () => void
  onZoom: () => void
  onDragStart?: (paneId: string, e: PointerEvent<HTMLElement>) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const spawned = useRef(false)
  const lineBuf = useRef('')
  const [dragOver, setDragOver] = useState(false)
  const [dropStatus, setDropStatus] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(pane.title)

  const provider = providers.find((p) => p.id === pane.engine)
  const engineName = provider?.name ?? pane.engine ?? 'idle'

  useEffect(() => {
    spawned.current = false
    if (!pane.engine || !host.current) {
      termRef.current?.dispose()
      termRef.current = null
      return
    }

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: 'Cascadia Mono, Cascadia Code, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#0b0d10',
        foreground: '#d6deea',
        cursor: '#39ffb6',
        cursorAccent: '#07080a',
        selectionBackground: '#214283',
        black: '#0b0d10',
        red: '#ff5c7a',
        green: '#39ffb6',
        yellow: '#f5c542',
        blue: '#7aa2ff',
        magenta: '#c084fc',
        cyan: '#5eead4',
        white: '#d6deea',
        brightBlack: '#4e5868',
        brightRed: '#ff8aa0',
        brightGreen: '#7dffd2',
        brightYellow: '#ffe08a',
        brightBlue: '#a8c4ff',
        brightMagenta: '#ddb4ff',
        brightCyan: '#99f6e4',
        brightWhite: '#ffffff'
      },
      allowProposedApi: true,
      scrollback: 4000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    // Clipboard: Electron has no context menu and the browser paste never
    // reaches the pty reliably — handle it explicitly via main-process
    // clipboard (no permission prompts) + xterm paste (bracketed-paste aware).
    term.attachCustomKeyEventHandler((e) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.altKey && e.code === 'KeyV') {
        // Ctrl+V / Ctrl+Shift+V — paste from system clipboard.
        e.preventDefault()
        void pasteFromClipboard()
        return false
      }
      if (mod && e.shiftKey && !e.altKey && e.code === 'KeyC') {
        // Ctrl+Shift+C — copy selection (plain Ctrl+C stays ETX for the pty).
        e.preventDefault()
        void copySelectionToClipboard()
        return false
      }
      if (!mod && e.shiftKey && !e.altKey && e.code === 'Insert') {
        e.preventDefault()
        void pasteFromClipboard()
        return false
      }
      return true
    })
    term.open(host.current)
    termRef.current = term
    fitRef.current = fit

    // sessions run in the main process for as long as the app lives — this pane
    // may mount, unmount, or just stay hidden; here we only attach to the stream.
    const stream = { applied: false, dropUntil: 0, pending: [] as { d: string; s: number }[] }
    const offData = window.pq.terminals.onData((id, data, seq) => {
      if (id !== pane.id) return
      if (!stream.applied) {
        stream.pending.push({ d: data, s: seq })
        if (stream.pending.length > 500) stream.pending.shift()
        return
      }
      if (!seq || seq > stream.dropUntil) term.write(data)
    })
    const offExit = window.pq.terminals.onExit((id, code) => {
      if (id === pane.id) {
        term.write(`\r\n\x1b[90m[pqTERM] process exit ${code}\x1b[0m\r\n`)
      }
    })
    term.onData((d) => {
      window.pq.terminals.write(pane.id, d)
      if (d.startsWith('\x1b')) return
      for (const ch of d) {
        if (ch === '\r' || ch === '\n') {
          const line = lineBuf.current
          lineBuf.current = ''
          const intent = parseGridIntent(line)
          if (intent) {
            void window.pq.panes.fill({
              engine: intent.engine || (pane.engine as string),
              prompt: intent.prompt,
              skipPaneId: pane.id
            })
          }
        } else if (ch === '\b' || ch === '\x7f') {
          lineBuf.current = lineBuf.current.slice(0, -1)
        } else if (ch >= ' ') {
          lineBuf.current += ch
          if (lineBuf.current.length > 400) lineBuf.current = lineBuf.current.slice(-400)
        }
      }
    })

    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        if (!spawned.current) return
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          window.pq.terminals.resize(pane.id, term.cols, term.rows)
        }, 50)
      } catch {
        /* ignore */
      }
    })
    ro.observe(host.current)

    const start = async () => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
      const res = await window.pq.terminals.spawn({
        paneId: pane.id,
        workspaceId,
        engine: pane.engine as EngineId,
        model: pane.model,
        cols: term.cols,
        rows: term.rows
      })
      stream.dropUntil = res.replaySeq
      stream.applied = true
      if (res.replay) term.write(res.replay)
      for (const c of stream.pending) {
        if (!c.s || c.s > stream.dropUntil) term.write(c.d)
      }
      stream.pending = []
      spawned.current = true
    }
    requestAnimationFrame(() => {
      void start()
    })

    return () => {
      offData()
      offExit()
      ro.disconnect()
      clearTimeout(resizeTimer)
      term.dispose()
      termRef.current = null
      // do NOT kill the pty — the session keeps running in the main process
    }
    // re-attach only when engine identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id, pane.engine, pane.model, workspaceId])

  useEffect(() => {
    try {
      fitRef.current?.fit()
      const term = termRef.current
      if (term && spawned.current) {
        window.pq.terminals.resize(pane.id, term.cols, term.rows)
      }
    } catch {
      /* ignore */
    }
  }, [zoomed, focused, pane.id])

  useEffect(() => {
    if (focused && renameNonce > 0) beginRename()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameNonce])

  useEffect(() => {
    if (!focused || editing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2') return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      beginRename()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, editing, pane.title])

  function beginRename(): void {
    const start = isDefaultPaneTitle(pane.title, engineName) ? '' : pane.title
    setDraft(start)
    setEditing(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  async function commitRename(): Promise<void> {
    setEditing(false)
    const t = clipTitle(draft, 60)
    if (!t) {
      await window.pq.workspaces.setPane(workspaceId, pane.id, {
        title: engineName,
        titleLocked: false
      })
      return
    }
    await window.pq.workspaces.setPane(workspaceId, pane.id, { title: t, titleLocked: true })
  }

  async function unlockTitle(): Promise<void> {
    await window.pq.workspaces.setPane(workspaceId, pane.id, {
      title: engineName,
      titleLocked: false
    })
  }

  async function pasteFromClipboard(): Promise<void> {
    const term = termRef.current
    if (!term) return
    try {
      const text = await window.pq.terminals.clipboardRead()
      if (!text) return
      // Enter sends \r — normalize pasted newlines the same way so multi-line
      // paste behaves like typed input in every engine.
      term.paste(text.replace(/\r\n|\r|\n/g, '\r'))
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  async function copySelectionToClipboard(): Promise<boolean> {
    const term = termRef.current
    if (!term || !term.hasSelection()) return false
    const sel = term.getSelection()
    if (!sel) return false
    try {
      await window.pq.terminals.clipboardWrite(sel)
    } catch {
      return false
    }
    term.clearSelection()
    return true
  }

  const enabled = providers.filter((p) => p.enabled && p.id !== 'shell')
  const shell = providers.find((p) => p.id === 'shell')

  async function launch(engine: EngineId, allIdle = false) {
    if (allIdle) {
      await window.pq.panes.fill({ engine })
      return
    }
    const p = providers.find((x) => x.id === engine)
    await window.pq.workspaces.setPane(workspaceId, pane.id, {
      engine,
      title: p?.name ?? engine,
      titleLocked: false
    })
  }


  function onDragOver(e: DragEvent): void {
    if (!pane.engine) return
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    // dropEffect 'copy' is only the OS cursor hint (link/move/copy). We do NOT copy file
    // bytes into the PTY — we insert quoted absolute paths (paths-only DnD).
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  function onDragLeave(e: DragEvent): void {
    // dragleave fires when moving between children too — only clear when the
    // pointer truly left the pane (or left the window: relatedTarget === null).
    const next = e.relatedTarget as unknown as Node | null
    if (next && e.currentTarget.contains(next)) return
    setDragOver(false)
  }

  function onDropFiles(e: DragEvent): void {
    e.preventDefault()
    setDragOver(false)
    if (!pane.engine) return
    const files = [...e.dataTransfer.files]
    if (!files.length) return
    const paths: string[] = []
    const failed: string[] = []
    for (const f of files) {
      const abs = window.pq.files.pathFor(f)
      if (abs) paths.push(abs)
      else failed.push(f.name || '(unnamed)')
    }
    if (failed.length) {
      const msg = `DnD: failed to resolve path (${failed.length}/${files.length}): ${failed.slice(0, 3).join(', ')}`
      console.warn('[pqTERM]', msg)
      setDropStatus(msg)
      window.setTimeout(() => setDropStatus(null), 4000)
    }
    const payload = formatDroppedPaths(paths, pathShellForPane({ engine: pane.engine }))
    if (!payload) {
      if (!failed.length) {
        setDropStatus('DnD: no paths to insert')
        window.setTimeout(() => setDropStatus(null), 3000)
      }
      return
    }
    onFocus()
    window.pq.terminals.write(pane.id, payload)
  }

  function onHeadPointerDown(e: PointerEvent<HTMLElement>): void {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, input')) return
    if (!onDragStart) return
    onDragStart(pane.id, e)
  }

  return (
    <section
      className={`pane${focused ? ' focused' : ''}${zoomed ? ' zoomed-pane' : ''}${dragOver ? ' drop-target' : ''}`}
      data-pane-id={pane.id}
      style={areaStyle(area)}
      onMouseDown={onFocus}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDropFiles}
    >
      <div
        className="pane-head"
        onPointerDown={onHeadPointerDown}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button, input, .t')) return
          onZoom()
        }}
      >
        <EngineMark
          id={pane.engine ?? undefined}
          name={provider?.name ?? engineName}
          color={provider?.color ?? '#4e5868'}
          logo={provider?.logo}
          icon={provider?.icon}
          mark={provider?.mark}
          size={20}
        />
<span className="slot" title={`pqterm send ${index} …`}>
          {index}
        </span>
        {editing ? (
          <input
            ref={inputRef}
            className="rename"
            value={draft}
            placeholder={engineName}
            maxLength={60}
            onChange={(e) => setDraft(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commitRename()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setEditing(false)
              }
            }}
          />
        ) : (
          <span
            className="t"
            title={`${cwd} · dwuklik albo F2 — własny tytuł`}
            onDoubleClick={(e) => {
              e.stopPropagation()
              beginRename()
            }}
          >
            {pane.engine ? pane.title : 'idle'}
            {pane.model ? ` · ${pane.model}` : ''}
          </span>
        )}
        {pane.titleLocked ? (
          <button
            className="iconx lock"
            title="tytuł ręczny — kliknij, żeby wrócić do nazwy CLI"
            onClick={(e) => {
              e.stopPropagation()
              void unlockTitle()
            }}
          >
            ●
          </button>
        ) : null}
        {pane.engine && usage ? <UsageChip usage={usage} /> : null}
        <button
          className="iconx zoom"
          title={zoomed ? 'wróć do siatki (ctrl+shift+g)' : 'powiększ na całą siatkę (ctrl+shift+f)'}
          onClick={(e) => {
            e.stopPropagation()
            onZoom()
          }}
        >
          {zoomed ? '⊟' : '⛶'}
        </button>
        {pane.engine ? (
          <button
            className="iconx"
            title="zamknij sesję"
            onClick={(e) => {
              e.stopPropagation()
              void window.pq.terminals.clearPane(workspaceId, pane.id)
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      {pane.engine ? (
        <>
          <div
            className="xterm-host"
            ref={host}
            onContextMenu={(e) => {
              // Windows-Terminal behavior: selection present → copy it,
              // otherwise paste from system clipboard.
              e.preventDefault()
              e.stopPropagation()
              void copySelectionToClipboard().then((copied) => {
                if (!copied) void pasteFromClipboard()
              })
            }}
          />
          {dropStatus ? <div className="drop-overlay drop-status">{dropStatus}</div> : null}
          {dragOver ? <div className="drop-overlay">upuść ścieżki</div> : null}
        </>
      ) : (
        <div className="picker">
          <h3>SPAWN ENGINE</h3>
          <div className="hint" style={{ marginTop: -8 }}>
            shift+klik = wszystkie puste okna
          </div>
          <div className="engines">
            {enabled.map((p) => (
              <button
                key={p.id}
                className="eng"
                disabled={!p.installed}
                onClick={(e) => launch(p.id, e.shiftKey)}
              >
                <EngineMark
                  id={p.id}
                  name={p.name}
                  color={p.color}
                  logo={p.logo}
                  icon={p.icon}
                  mark={p.mark}
                  size={34}
                />
                <span className="n" style={{ color: p.color }}>
                  {p.name}
                </span>
                <span className="v">{p.vendor}</span>
                <span className="st">
                  {p.installed ? (p.detectedAuth ? 'detected' : 'installed') : 'not on PATH'}
                </span>
              </button>
            ))}
            {shell ? (
              <button className="eng" onClick={() => launch('shell')}>
                <EngineMark id={shell.id} name={shell.name} color={shell.color} logo={shell.logo} icon={shell.icon} mark={shell.mark} size={34} />
                <span className="n" style={{ color: shell.color }}>
                  PowerShell
                </span>
                <span className="v">Windows</span>
                <span className="st">raw shell</span>
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}
