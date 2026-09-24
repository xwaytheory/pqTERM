import { useEffect, useRef, useState } from 'react'
import type { AccentId, AppSnapshot, CursorStyleId, FontId, UiSettings } from '../../../shared/types'
import {
  ACCENT_IDS,
  CURSOR_STYLE_IDS,
  FONT_IDS,
  UI_FONT_MAX,
  UI_FONT_MIN
} from '../../../shared/types'
import NotificationsPanel from './NotificationsPanel'
import ProvidersPanel from './ProvidersPanel'
import RemotePanel from './RemotePanel'

const TABS = [
  { id: 'look', label: 'wygląd' },
  { id: 'term', label: 'terminal' },
  { id: 'notify', label: 'powiadomienia' },
  { id: 'engines', label: 'silniki' },
  { id: 'phone', label: 'telefon' }
] as const
type TabId = (typeof TABS)[number]['id']

const ACCENT_LABEL: Record<AccentId, string> = {
  mono: 'szarość',
  mint: 'mięta',
  blue: 'błękit',
  amber: 'bursztyn'
}

const CURSOR_LABEL: Record<CursorStyleId, string> = {
  bar: 'kreska',
  block: 'blok',
  underline: 'podkreślenie'
}

const FONT_LABEL: Record<FontId, string> = {
  cascadia: 'Cascadia Mono',
  consolas: 'Consolas',
  jetbrains: 'JetBrains Mono',
  ibmplex: 'IBM Plex Mono'
}

const SCROLLBACKS = [1000, 4000, 10000]

/**
 * The one settings surface: `config` lives in main (`state.ui`) so every control
 * applies immediately — no save button, the snapshot coming back over
 * `state:changed` is what these controls render. Engines, notifications and the
 * phone bridge are tabs in here instead of three separate dock buttons.
 */
export default function SettingsModal({ snap, onClose }: { snap: AppSnapshot; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('look')
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const ui = snap.ui

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  function apply(patch: Partial<UiSettings>): void {
    setError('')
    void window.pq.ui.set(patch).catch((cause) => {
      console.error('[pqTERM] settings failed', cause)
      setError('Nie udało się zapisać ustawienia. Spróbuj ponownie.')
    })
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div
        ref={dialog}
        className="modal settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
            return
          }
          if (e.key !== 'Tab') return
          const controls = dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled)'
          )
          if (!controls?.length) return
          const first = controls[0]
          const last = controls[controls.length - 1]
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }}
      >
        <h2 id="settings-title">USTAWIENIA</h2>
        <div className="tabs" role="tablist" aria-label="sekcje ustawień">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'on' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="tab-body" role="tabpanel">
          {tab === 'look' ? (
            <>
              <div className="sub">
                Akcent dotyczy wyłącznie własnego chrome’u pqTERM — pasków, ramek, fokusu i
                przycisków. Kolory CLI w terminalu zostają bez zmian (diff, git status, logi).
              </div>
              <label className="f">AKCENT</label>
              <div className="chips">
                {ACCENT_IDS.map((id) => (
                  <button
                    key={id}
                    className={`chip${ui.accent === id ? ' on' : ''}`}
                    aria-pressed={ui.accent === id}
                    onClick={() => apply({ accent: id })}
                  >
                    <i className={`swatch accent-${id}`} aria-hidden /> {ACCENT_LABEL[id]}
                  </button>
                ))}
              </div>
              <p className="hint">
                kolory dwóch silników (np. Freebuff) i ich znaki w gridzie należą do dostawców —
                te zostają firmowe.
              </p>
            </>
          ) : null}

          {tab === 'term' ? (
            <>
              <label className="f">CZCIONKA TERMINALA</label>
              <div className="chips">
                {FONT_IDS.map((id) => (
                  <button
                    key={id}
                    className={`chip${ui.fontId === id ? ' on' : ''}`}
                    aria-pressed={ui.fontId === id}
                    onClick={() => apply({ fontId: id })}
                  >
                    {FONT_LABEL[id]}
                  </button>
                ))}
              </div>
              <label className="f">ROZMIAR — {ui.fontSize} PX</label>
              <div className="stepper">
                <button
                  className="ghost"
                  disabled={ui.fontSize <= UI_FONT_MIN}
                  aria-label="mniejsza czcionka"
                  onClick={() => apply({ fontSize: ui.fontSize - 1 })}
                >
                  −
                </button>
                <span>{ui.fontSize} px</span>
                <button
                  className="ghost"
                  disabled={ui.fontSize >= UI_FONT_MAX}
                  aria-label="większa czcionka"
                  onClick={() => apply({ fontSize: ui.fontSize + 1 })}
                >
                  +
                </button>
              </div>
              <label className="f">KURSOR</label>
              <div className="chips">
                {CURSOR_STYLE_IDS.map((id) => (
                  <button
                    key={id}
                    className={`chip${ui.cursorStyle === id ? ' on' : ''}`}
                    aria-pressed={ui.cursorStyle === id}
                    onClick={() => apply({ cursorStyle: id })}
                  >
                    {CURSOR_LABEL[id]}
                  </button>
                ))}
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={ui.cursorBlink}
                  onChange={(e) => apply({ cursorBlink: e.target.checked })}
                />
                migający kursor
              </label>
              <label className="f">HISTORIA (SCROLLBACK, LINIE)</label>
              <div className="chips">
                {SCROLLBACKS.map((n) => (
                  <button
                    key={n}
                    className={`chip${ui.scrollback === n ? ' on' : ''}`}
                    aria-pressed={ui.scrollback === n}
                    onClick={() => apply({ scrollback: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="hint">
                rozmiar czcionki przelicza siatkę i wymusza przemalowanie terminala — CLI dostaje
                nowy rozmiar od razu.
              </p>
            </>
          ) : null}

          {tab === 'notify' ? <NotificationsPanel settings={snap.notifications} /> : null}
          {tab === 'engines' ? (
            <ProvidersPanel providers={snap.providers} email={snap.user?.email} />
          ) : null}
          {tab === 'phone' ? <RemotePanel onClose={onClose} /> : null}
        </div>

        {error ? <p role="alert" className="notification-error">{error}</p> : null}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            zamknij
          </button>
        </div>
      </div>
    </div>
  )
}
