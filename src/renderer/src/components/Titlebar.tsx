import { useEffect, useState, type ReactNode } from 'react'

export default function Titlebar({ center }: { center?: ReactNode }) {
  const [name, setName] = useState('pqTERM')
  useEffect(() => {
    void window.pq.app.info().then((i) => setName(i.name))
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
        {name}
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
