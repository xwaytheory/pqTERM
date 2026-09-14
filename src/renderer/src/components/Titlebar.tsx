import { useEffect, useState, type ReactNode } from 'react'

export default function Titlebar({ center }: { center?: ReactNode }) {
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
    <header className="titlebar">
      <div className="brand">
        <span className="grid-mark" aria-hidden>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
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
      <div className="center">{center}</div>
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
