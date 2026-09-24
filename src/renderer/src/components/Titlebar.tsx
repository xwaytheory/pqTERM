import { useEffect, useState } from 'react'
import brandMark from '../assets/brand-mark.png'

/**
 * Frameless window chrome: brand on the left, window buttons on the right. The
 * middle used to repeat the active workspace — the sidebar and the panes already
 * say that, so it is gone and the bar is just a drag surface.
 */
export default function Titlebar() {
  const [info, setInfo] = useState<{
    name: string
    edition: 'pq' | 'dev' | 'test'
    build: number
    version: string
  } | null>(null)
  useEffect(() => {
    void window.pq.app.info().then(setInfo)
  }, [])
  return (
    // `data-tauri-drag-region` is what the Tauri track uses for window dragging (Tauri injects
    // drag.js, which only starts a drag when the event target carries this attribute; Electron
    // ignores it and uses the -webkit-app-region rules from styles.css).
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand">
        <img className="brand-mark" src={brandMark} alt="" aria-hidden />
        {info?.name ?? 'pqTERM'}
        {info && (
          <span className="edition-chip">
            {info.edition === 'dev'
              ? 'dev'
              : info.edition === 'test'
                ? 'test'
                : 'stable'}{' '}
            · v{info.version} · build {info.build}
          </span>
        )}
      </div>
      <div className="win">
        <button className="winbtn" onClick={() => window.pq.app.minimize()} title="minimalizuj">
          ─
        </button>
        <button className="winbtn" onClick={() => window.pq.app.maximize()} title="maksymalizuj">
          ▢
        </button>
        <button className="winbtn close" onClick={() => window.pq.app.close()} title="zamknij">
          ×
        </button>
      </div>
    </header>
  )
}
