import { memo, useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import {
  ACTIVITY_LABELS,
  clipTitle,
  FONT_STACKS,
  isDefaultPaneTitle,
  isRawShell,
  parseGridIntent,
  type CursorStyleId,
  type EngineId,
  type EngineUsage,
  type FontId,
  type PaneArea,
  type PaneActivity,
  type PaneState,
  type ProviderInfo
} from '../../../shared/types'
import { areaStyle } from '../../../shared/grid'
import { paneUnderMin } from '../../../shared/term-geometry'
import { formatDroppedPaths, pathShellForPane, quotePath } from '../lib/dropPaths'
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

function TerminalPane({
  pane,
  workspaceId,
  cwd,
  providers,
  focused,
  zoomed,
  renameNonce,
  usage,
  activity,
  focusRequest,
  index,
  area,
  fontId,
  fontSize,
  cursorStyle,
  cursorBlink,
  scrollback,
  isLast,
  onAdd,
  onClose,
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
  activity?: PaneActivity
  focusRequest: number
  index: number
  area?: PaneArea
  fontId: FontId
  fontSize: number
  cursorStyle: CursorStyleId
  cursorBlink: boolean
  scrollback: number
  /** bottom-right slot of the grid — the one that carries the "add pane" button */
  isLast: boolean
  onAdd: () => void
  onClose: () => void
  onFocus: () => void
  onZoom: () => void
  onDragStart?: (paneId: string, e: PointerEvent<HTMLElement>) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const appliedFocusRequest = useRef(0)
  const spawned = useRef(false)
  const lineBuf = useRef('')
  // ConPTY resize-repaint does NOT erase the old frame — cells not covered by
  // the new repaint keep stale content (ghost/doubled TUI). Before the first
  // data after a real PTY resize we erase the viewport so the repaint lands
  // on a clean slate (same trick Windows Terminal does internally).
  const pendingClearRef = useRef(false)
  const lastSentSizeRef = useRef<{ c: number; r: number }>({ c: 0, r: 0 })
  // Pane is laid out below the geometry floor: the terminal keeps its last good
  // size, so what you would see is a bigger frame clipped by the pane border —
  // it reads as corruption. Blank it and say why instead.
  const [tooSmall, setTooSmall] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [dropStatus, setDropStatus] = useState<string | null>(null)
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  const [installError, setInstallError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(pane.title)

  const provider = providers.find((p) => p.id === pane.engine)
  const engineName = provider?.name ?? pane.engine ?? 'idle'

  /** PTY resize that arms a viewport erase before the ConPTY repaint lands. */
  function sendResize(c: number, r: number): void {
    const last = lastSentSizeRef.current
    if (last.c === c && last.r === r) return
    lastSentSizeRef.current = { c, r }
    pendingClearRef.current = true
    window.pq.terminals.resize(pane.id, c, r)
  }

  useEffect(() => {
    spawned.current = false
    if (!pane.engine || !host.current) {
      termRef.current?.dispose()
      termRef.current = null
      return
    }

    const term = new Terminal({
      cursorBlink,
      cursorStyle,
      fontFamily: FONT_STACKS[fontId],
      fontSize,
      lineHeight: 1.2,
      theme: {
        background: '#0b0d10',
        foreground: '#d6deea',
        // Chrome is grayscale (Settings → wygląd); the ANSI palette stays a
        // normal one so CLI colour keeps meaning (diffs, git status, logs).
        cursor: '#dfe4ea',
        cursorAccent: '#07080a',
        selectionBackground: '#2b3138',
        black: '#0b0d10',
        red: '#ff5c7a',
        green: '#3fb950',
        yellow: '#f5c542',
        blue: '#7aa2ff',
        magenta: '#c084fc',
        cyan: '#5eead4',
        white: '#d6deea',
        brightBlack: '#4e5868',
        brightRed: '#ff8aa0',
        brightGreen: '#56d364',
        brightYellow: '#ffe08a',
        brightBlue: '#a8c4ff',
        brightMagenta: '#ddb4ff',
        brightCyan: '#99f6e4',
        brightWhite: '#ffffff'
      },
      allowProposedApi: true,
      scrollback,
      // Sessions run through node-pty with useConpty:true — tell xterm so its
      // ConPTY heuristics apply (wrapped-line detection, scrollback-on-grow).
      // Without this, TUI redraws leave glued/duplicated line fragments
      // (e.g. "ugSuggested", "ress Enter") because xterm assumes unwrapped
      // lines when ConPTY repaints them.
      windowsPty: { backend: 'conpty' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const openLink = (_ev: MouseEvent, uri: string) => {
      void window.pq.app.openUrl(uri)
    }
    term.options.linkHandler = { activate: openLink, allowNonHttpProtocols: false }
    term.loadAddon(new WebLinksAddon(openLink))
    // Clipboard: Electron has no context menu and the browser paste never
    // reaches the pty reliably — handle it explicitly via main-process
    // clipboard (no permission prompts) + xterm paste (bracketed-paste aware).
    term.attachCustomKeyEventHandler((e) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.altKey && e.code === 'KeyV') {
if (pane.engine && !isRawShell(pane.engine)) {
          // Agent TUIs (opencode & co.) handle clipboard themselves via
          // DOM paste → bracketed paste → own PowerShell clipboard read.
          // Let xterm.js pass the event through so they receive [Image 1].
          return true
        }
        // Shell panes: Electron DOM paste is unreliable — handle via
        // main-process clipboard + xterm paste.
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
    const stream = {
      applied: false,
      dropUntil: 0,
      pending: [] as { d: string; s: number }[],
      overflowed: false
    }
    const offData = window.pq.terminals.onData((id, data, seq) => {
      if (id !== pane.id) return
      if (!stream.applied) {
        stream.pending.push({ d: data, s: seq })
        // Never shift() here: a dropped chunk tears the escape sequence that
        // spans it, which is what smears fragments of old frames onto the
        // screen. Flag the overflow and re-attach from main's buffer instead.
        if (stream.pending.length > 500) stream.overflowed = true
        return
      }
      if (!seq || seq > stream.dropUntil) {
        if (pendingClearRef.current) {
          pendingClearRef.current = false
          // Erase AND home: ConPTY's repaint assumes the cursor is where its own
          // model put it, so erasing without homing lands the frame offset.
          term.write('\x1b[2J\x1b[H')
        }
        term.write(data)
      }
    })
    const offExit = window.pq.terminals.onExit((id, code) => {
      if (id !== pane.id) return
      term.write(`\r\n\x1b[90m[pqTERM] process exit ${code}\x1b[0m\r\n`)
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

    // A window that comes back from minimize gets no resize callback, and xterm
    // only repaints when something asked for a refresh while it was paused — so
    // ask, explicitly. This repaints xterm's own buffer: no reflow, no PTY hop.
    const onVisibility = () => {
      const term = termRef.current
      if (document.visibilityState === 'visible' && term) term.refresh(0, term.rows - 1)
    }
    document.addEventListener('visibilitychange', onVisibility)

    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      try {
        // hidden hosts report 0x0 — fitting them would shrink the PTY to the
        // minimum and garble output; fit only when the host is actually laid out
        if (!host.current || host.current.clientHeight < 10 || host.current.clientWidth < 10) return
        // A pane smaller than MIN_PANE_* must not drive the PTY: ConPTY reflows
        // to a ~2-column terminal and the TUI comes back as one letter per
        // line. Keep the last good fit; refit when the pane grows again.
        const small = paneUnderMin(host.current.clientWidth, host.current.clientHeight)
        setTooSmall(small)
        if (small) return
        fit.fit()
        if (!spawned.current) return
        // Coalesce a burst of layout callbacks (window drag, pane-edge drag,
        // maximize) into ONE resize to the PTY 50 ms after the layout settles.
        // Every resize makes ConPTY repaint the whole viewport, and a repaint
        // racing xterm's own reflow is what smears old frames across the pane -
        // so fewer, later resizes beat a resize per frame.
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => sendResize(term.cols, term.rows), 50)
      } catch {
        /* ignore */
      }
    })
    ro.observe(host.current)

    const start = async () => {
      try {
        // Same floor as the ResizeObserver: a pane born below it must not
        // propose 2-column geometry to the PTY on its first fit.
        if (host.current && !paneUnderMin(host.current.clientWidth, host.current.clientHeight)) fit.fit()
      } catch {
        /* ignore */
      }
      let res = await window.pq.terminals.spawn({
        paneId: pane.id,
        workspaceId,
        engine: pane.engine as EngineId,
        model: pane.model,
        cols: term.cols,
        rows: term.rows
      })
      if (stream.overflowed) {
        // Output outran this view while it was attaching. Main's buffer already
        // holds everything that was queued, so re-attach from that single piece.
        const whole = await window.pq.terminals.buffer(pane.id)
        res = { ...res, replay: whole.data, replaySeq: whole.seq, replayCols: whole.cols, replayRows: whole.rows }
        stream.pending = []
      }
      stream.dropUntil = res.replaySeq
      stream.applied = true
      // The PTY is not necessarily where we asked it to be: a resumed session
      // keeps its own geometry and the boot path spawns at 80x24. Record what it
      // reports, or the resize below looks like a no-op to the dedupe and ConPTY
      // never repaints — the replayed frame then stays reflowed (old lines
      // glued and smeared across the viewport).
      lastSentSizeRef.current = { c: res.replayCols || term.cols, r: res.replayRows || term.rows }
      // Replay the buffer in the size it was captured at — ConPTY positioned
      // cursor/erasures for those cols, so rendering it at the current size
      // glues fragments of old lines into new ones. Resize back to fit after
      // and let the PTY repaint cleanly at the real size.
      // ponytail: only the buffer tail is guaranteed to match replayCols, so a
      // persisted seed can still hold content drawn at older widths (harmless:
      // the forced resize below makes ConPTY repaint the whole viewport).
      // Upgrade: seed the log with the tail only.
      const rc = res.replayCols
      const rr = res.replayRows
      if (res.replay && rc && rr && (rc !== term.cols || rr !== term.rows)) {
        try {
          term.resize(rc, rr)
          term.write(res.replay)
          try {
            fit.fit()
          } catch {
            /* ignore */
          }
        } catch {
          term.write(res.replay)
        }
      } else if (res.replay) {
        term.write(res.replay)
      }
      // Align the PTY with the fitted view on EVERY attach, replay or not. The
      // PTY is not necessarily where we asked it to be: boot spawns the active
      // workspace at 80x24 (restoreSession) and spawn() then hands back that
      // live session instead of starting one at our size. An empty replay (the
      // CLI had not printed yet - the usual race) used to skip the only resize
      // on this path, so the TUI kept drawing for 80 columns inside a wider
      // xterm until some later window/pane/zoom event "fixed" it - that jump
      // plus the stale-width frame is what looks like artifacts. Deduped by
      // sendResize: nothing is sent when the PTY already sits at this size.
      sendResize(term.cols, term.rows)
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
      document.removeEventListener('visibilitychange', onVisibility)
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
      if (!host.current || host.current.clientHeight < 10) return
      if (paneUnderMin(host.current.clientWidth, host.current.clientHeight)) return
      fitRef.current?.fit()
      const term = termRef.current
      if (term && spawned.current) {
        sendResize(term.cols, term.rows)
      }
    } catch {
      /* ignore */
    }
  }, [zoomed, focused, pane.id])

  // Look settings apply live: cursor options are plain option writes.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.cursorBlink = cursorBlink
    term.options.cursorStyle = cursorStyle
    term.options.scrollback = scrollback
  }, [cursorBlink, cursorStyle, scrollback])

  // A font change moves the cell size, so the fit (and with it the PTY size) must
  // be recomputed — on the next frame, once xterm has re-measured the cell.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontFamily = FONT_STACKS[fontId]
    term.options.fontSize = fontSize
    const frame = requestAnimationFrame(() => {
      const hostEl = host.current
      if (!hostEl || !termRef.current) return
      try {
        if (paneUnderMin(hostEl.clientWidth, hostEl.clientHeight)) return
        fitRef.current?.fit()
        if (spawned.current) sendResize(termRef.current.cols, termRef.current.rows)
      } catch {
        /* ignore */
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [fontId, fontSize])

  useEffect(() => {
    if (!focusRequest || appliedFocusRequest.current === focusRequest) return
    const frame = requestAnimationFrame(() => {
      if (!host.current?.clientHeight || !termRef.current) return
      appliedFocusRequest.current = focusRequest
      termRef.current.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, pane.engine])

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
    const t = clipTitle(draft, 120)
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
      // Try image clipboard first (more reliable for images than the
      // combined text-first clipboardRead which may miss images).
      const imagePath = await window.pq.terminals.clipboardReadImage()
      if (imagePath) {
        // Image saved by main process; paste its quoted file path so plain
        // shells can reference the file.
        const quotedPath = quotePath(imagePath, 'cmd')
        term.paste(quotedPath.replace(/\r\n|\r|\n/g, '\r'))
        return
      }
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

  const enabled = providers.filter((p) => p.enabled && !isRawShell(p.id))
  const rawShells = providers.filter((p) => isRawShell(p.id))

  function tileName(p: ProviderInfo): string {
    return p.id === 'shell' ? 'PowerShell' : p.name
  }

  // All tiles (CLIs + raw shell) sorted alphabetically so the grid reads
  // the same in every pane size.
  const tiles = [...enabled, ...rawShells]
  tiles.sort((a, b) => tileName(a).localeCompare(tileName(b), 'en', { sensitivity: 'base' }))

  async function launch(engine: EngineId, allIdle = false) {
    if (allIdle) {
      await window.pq.panes.fill({ engine })
      return
    }
    setInstallError(null)
    let p = providers.find((x) => x.id === engine)
    if (p && !p.installed) {
      // Re-scan first so a finished external install (cmd window) turns the
      // NEXT click into a launch instead of re-opening the installer.
      try {
        p = (await window.pq.providers.scan()).find((x) => x.id === engine)
      } catch {
        /* stale p is fine */
      }
    }
    if (p && !p.installed) {
      setInstalling((prev) => new Set(prev).add(engine))
      try {
        const res = await window.pq.engines.install(engine)
        if (!res.ok) setInstallError(res.message)
      } catch (err) {
        setInstallError(err instanceof Error ? err.message : String(err))
      } finally {
        setInstalling((prev) => {
          const next = new Set(prev)
          next.delete(engine)
          return next
        })
      }
      // pane launches on the next click, once the scan actually detects the CLI
      return
    }
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
      className={`pane${focused ? ' focused' : ''}${zoomed ? ' zoomed-pane' : ''}${dragOver ? ' drop-target' : ''}${activity?.unread ? ' activity-unread' : ''}`}
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
            maxLength={120}
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
            title={`${pane.title} — ${cwd} · dwuklik albo F2 — własny tytuł`}
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
        {activity ? (
          <span
            className={`activity-badge activity-${activity.kind}${activity.unread ? ' unread' : ''}`}
            title={`${ACTIVITY_LABELS[activity.kind]}${activity.unread ? ' · nieprzeczytane' : ''}`}
            aria-label={`${ACTIVITY_LABELS[activity.kind]}${activity.unread ? ' · nieprzeczytane' : ''}`}
          >
            {ACTIVITY_LABELS[activity.kind]}
          </span>
        ) : null}
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
        {isLast ? (
          <button
            className="iconx add"
            title="dodaj okno CLI — otworzy się puste, z wyborem silnika"
            aria-label="dodaj okno CLI"
            onClick={(e) => {
              e.stopPropagation()
              onAdd()
            }}
          >
            +
          </button>
        ) : null}
        <button
          className="iconx"
          title={
            pane.engine
              ? 'zamknij okno — sesja CLI zostanie zakończona, siatka zmieści pozostałe'
              : 'usuń to puste okno z siatki'
          }
          aria-label="zamknij okno CLI"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          ×
        </button>
      </div>
      {pane.engine ? (
        <>
          <div
            className={`xterm-host${tooSmall ? ' too-small' : ''}`}
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
          {tooSmall ? <div className="pane-min-hint">okno za małe dla terminala — powiększ</div> : null}
          {dropStatus ? <div className="drop-overlay drop-status">{dropStatus}</div> : null}
          {dragOver ? <div className="drop-overlay">upuść ścieżki</div> : null}
        </>
      ) : (
        <div className="picker">
          <div className="picker-inner">
          <h3>SPAWN ENGINE</h3>
          {installError && (
            <div className="hint" style={{ marginTop: -8, color: '#ff387b' }}>
              {installError}
            </div>
          )}
          <div className="hint" style={{ marginTop: -8 }}>
            shift+klik = wszystkie puste okna
          </div>
          <div className="engines">
            {tiles.map((p) => {
              const isShell = isRawShell(p.id)
              const isInstalling = installing.has(p.id)
              const name = tileName(p)
              const vendor = isShell ? 'Windows' : p.vendor
              const status = isShell
                ? 'raw shell'
                : isInstalling
                  ? 'installing…'
                  : p.installed
                    ? p.detectedAuth
                      ? 'detected'
                      : 'installed'
                    : 'click to install'
              return (
                <button
                  key={p.id}
                  className={`eng${!p.installed ? ' disabled-visual' : ''}`}
                  style={!p.installed ? { opacity: 0.35, filter: 'grayscale(1)' } : undefined}
                  disabled={isInstalling}
                  title={`${name} · ${vendor}`}
                  onClick={(e) => launch(p.id, e.shiftKey)}
                >
                  <EngineMark
                    id={p.id}
                    name={name}
                    color={p.color}
                    logo={p.logo}
                    icon={p.icon}
                    mark={p.mark}
                    size={34}
                  />
                  <span className="meta">
                  <span className="n" style={{ color: p.color }}>
                    {name}
                  </span>
                  <span className="v">{vendor}</span>
                  <span className="st">{status}</span>
                  </span>
                </button>
              )
            })}
          </div>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Visited workspaces retain their xterm views; PTYs live independently in main.
 * When a view does remount, the replay buffer restores its terminal output.
 *
 * The handler props are deliberately left out of the comparison — DeckScreen rebuilds them on
 * every render, but each one reads live state through refs, so an older closure still acts on
 * the current workspace instead of a stale snapshot.
 */
export default memo(TerminalPane, (a, b) =>
  a.pane === b.pane &&
  a.workspaceId === b.workspaceId &&
  a.cwd === b.cwd &&
  a.providers === b.providers &&
  a.focused === b.focused &&
  a.zoomed === b.zoomed &&
  a.renameNonce === b.renameNonce &&
  a.usage === b.usage &&
  a.activity === b.activity &&
  a.focusRequest === b.focusRequest &&
  a.index === b.index &&
  a.area === b.area &&
  a.fontId === b.fontId &&
  a.fontSize === b.fontSize &&
  a.cursorStyle === b.cursorStyle &&
  a.cursorBlink === b.cursorBlink &&
  a.scrollback === b.scrollback &&
  a.isLast === b.isLast
)
