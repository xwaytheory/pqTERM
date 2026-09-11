import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { EngineId, PaneState, ProviderInfo } from '../../../shared/types'

export default function TerminalPane({
  pane,
  workspaceId,
  cwd,
  providers,
  focused,
  onFocus
}: {
  pane: PaneState
  workspaceId: string
  cwd: string
  providers: ProviderInfo[]
  focused: boolean
  onFocus: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const spawned = useRef(false)

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
    term.open(host.current)
    termRef.current = term
    fitRef.current = fit

    const offData = window.pq.terminals.onData((id, data) => {
      if (id === pane.id) term.write(data)
    })
    const offExit = window.pq.terminals.onExit((id, code) => {
      if (id === pane.id) {
        term.write(`\r\n\x1b[90m[pq] process exit ${code}\x1b[0m\r\n`)
      }
    })
    term.onData((d) => window.pq.terminals.write(pane.id, d))

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
      await window.pq.terminals.spawn({
        paneId: pane.id,
        workspaceId,
        engine: pane.engine as EngineId,
        model: pane.model,
        cols: term.cols,
        rows: term.rows
      })
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
      if (spawned.current) window.pq.terminals.kill(pane.id)
    }
    // re-spawn only when engine identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id, pane.engine, pane.model, workspaceId])

  const enabled = providers.filter((p) => p.enabled && p.id !== 'shell')
  const shell = providers.find((p) => p.id === 'shell')

  async function launch(engine: EngineId) {
    const p = providers.find((x) => x.id === engine)
    await window.pq.workspaces.setPane(workspaceId, pane.id, {
      engine,
      title: p?.name ?? engine
    })
  }

  return (
    <section className={focused ? 'pane focused' : 'pane'} onMouseDown={onFocus}>
      <div className="pane-head">
        <span className="dot" style={{ background: providers.find((p) => p.id === pane.engine)?.color ?? '#4e5868' }} />
        <span className="t">
          {pane.engine ? pane.title : 'idle'}
          {pane.model ? ` · ${pane.model}` : ''}
        </span>
        <span title={cwd}>{pane.engine ? 'live' : 'empty'}</span>
        {pane.engine ? (
          <button
            className="iconx"
            title="zamknij sesję"
            onClick={() => window.pq.terminals.clearPane(workspaceId, pane.id)}
          >
            ×
          </button>
        ) : null}
      </div>
      {pane.engine ? (
        <div className="xterm-host" ref={host} />
      ) : (
        <div className="picker">
          <h3>SPAWN ENGINE</h3>
          <div className="engines">
            {enabled.map((p) => (
              <button
                key={p.id}
                className="eng"
                disabled={!p.installed}
                onClick={() => launch(p.id)}
              >
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
