import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isRawShell, type EngineId, type ProviderInfo } from '../../../shared/types'
import { canSwitchWithContext, switchTargets } from '../../../shared/engineSwitch'
import EngineMark from './EngineMark'

/**
 * Menu for swapping the CLI in one session. Portal + fixed position: the
 * sidebar list scrolls and would clip an absolutely positioned dropdown.
 * Default is a clean swap ("tylko CLI") — "z kontekstem" is the existing
 * checkpoint handoff and is only offered when the source transcript is readable.
 *
 * A plain popover (role=dialog), not role=menu: WAI-ARIA menus require roving
 * arrow-key focus, and Tab order is the behaviour people expect from a form.
 */
export default function EngineSwitchMenu({
  anchor,
  title,
  providers,
  favorites,
  current,
  onPick,
  onClose
}: {
  anchor: HTMLElement
  /** session title, so the floating menu names the row it belongs to */
  title: string
  providers: ProviderInfo[]
  favorites: readonly EngineId[]
  current: EngineId | null
  onPick: (engine: EngineId, withContext: boolean) => void
  onClose: (focusAnchor?: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const canContext = canSwitchWithContext(current)
  const [withContext, setWithContext] = useState(false)
  const items = useMemo(
    () => switchTargets(providers, favorites, current),
    [providers, favorites, current]
  )
  const currentName = providers.find((p) => p.id === current)?.name ?? current ?? ''

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const a = anchor.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(a.left, window.innerWidth - r.width - 8))
    const below = a.bottom + 4
    const top =
      below + r.height + 8 > window.innerHeight ? Math.max(8, a.top - r.height - 4) : below
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [anchor])

  closeRef.current = onClose

  // The sidebar can unmount the anchor without any pointer event (search
  // filter, collapsed workspace). A fixed panel left over a row that no
  // longer exists would still swap a pane the user cannot see.
  useLayoutEffect(() => {
    // getClientRects() is empty when the sidebar is collapsed (display:none):
    // isConnected stays true, so a hidden anchor would keep the panel alive
    if (!anchor.isConnected || anchor.getClientRects().length === 0) closeRef.current()
  })

  useEffect(() => {
    // focus the panel itself: Tab then reaches the mode radios before the list,
    // and nothing is skipped the way a first-item focus skips them
    ref.current?.focus()
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (ref.current?.contains(t)) return
      // the logo button toggles the menu itself — closing here would reopen it
      if ((t as HTMLElement | null)?.closest('.engine-switch')) return
      closeRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current(true)
    }
    // Only the sidebar list moves the anchor. A capture listener also hears
    // xterm's viewport, which scrolls on every line of output — closing on
    // that would make the menu unusable in a live pane.
    const scroller = anchor.closest('.ws-list')
    const onScroll = (e: Event) => {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (scroller && t !== scroller) return
      closeRef.current(true)
    }
    const onBlur = () => closeRef.current()
    const onResize = () => closeRef.current(true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return createPortal(
    <div
      ref={ref}
      className="engine-menu"
      role="dialog"
      aria-label={`zmień CLI w sesji ${title}`}
      tabIndex={-1}
    >
      <div className="engine-menu-head">
        <span className="engine-menu-session">{title}</span>
        <span className="engine-menu-vendor">{currentName}</span>
      </div>
      <div className="engine-menu-modes">
        <button
          type="button"
          className={!withContext || !canContext ? 'on' : ''}
          aria-pressed={!withContext || !canContext}
          onClick={() => setWithContext(false)}
          title="podmiana samego CLI — nowa, pusta rozmowa w tym samym katalogu"
        >
          czysta sesja
        </button>
        <button
          type="button"
          className={withContext && canContext ? 'on' : ''}
          aria-pressed={withContext && canContext}
          disabled={!canContext}
          onClick={() => setWithContext(true)}
          title={
            canContext
              ? 'nowe CLI dostaje checkpoint rozmowy i kontynuuje pracę'
              : 'pqTERM nie potrafi odczytać rozmowy z tego CLI — dostępna tylko czysta sesja'
          }
        >
          z kontekstem
        </button>
      </div>
      <div className="engine-menu-hint">
        {withContext && canContext
          ? 'checkpoint rozmowy + seed; bieżący proces CLI zostanie zatrzymany'
          : 'czysta sesja — nowa rozmowa w tym katalogu; bieżący proces CLI zostanie zatrzymany'}
      </div>
      {items.length === 0 ? <div className="engine-menu-empty">brak innych silników</div> : null}
      {items.map((p) => {
        const usable = p.installed || isRawShell(p.id)
        return (
          <button
            key={p.id}
            type="button"
            className="engine-menu-item"
            disabled={!usable}
            title={
              usable
                ? `przełącz na ${p.name}`
                : `${p.name} — nie zainstalowano (kafelek w SPAWN ENGINE)`
            }
            onClick={() => onPick(p.id, withContext && canContext)}
          >
            <EngineMark
              id={p.id}
              name={p.name}
              color={p.color}
              logo={p.logo}
              icon={p.icon}
              mark={p.mark}
              size={16}
            />
            <span className="engine-menu-name">{p.name}</span>
            <span className="engine-menu-vendor">{usable ? p.vendor : 'nie zainstalowano'}</span>
          </button>
        )
      })}
    </div>,
    document.body
  )
}
