import { useEffect, useState } from 'react'
import type { RemoteInfo } from '../../../shared/types'

export default function RemotePanel({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    setInfo(await window.pq.remote.info())
  }

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 2000)
    return () => clearInterval(t)
  }, [])

  if (!info) return null

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>TELEFON</h2>
        <div className="sub">
          laptop jest źródłem. telefon tylko steruje — te same workspace’y, te same TUI, na żywo.
        </div>
        <div className="hint">
          {info.enabled ? (
            <>
              <div>
                PIN <b style={{ color: 'var(--green)', fontSize: 22, letterSpacing: '0.2em' }}>{info.pin}</b>
              </div>
              <div style={{ marginTop: 10 }}>otwórz na telefonie (Chrome / apka pq):</div>
              {info.urls.length ? (
                info.urls.map((u) => (
                  <div key={u}>
                    <code>{u}</code>
                  </div>
                ))
              ) : (
                <div>brak adresu LAN</div>
              )}
              <div style={{ marginTop: 10 }}>
                w domu: ten sam Wi-Fi. w podróży: Tailscale na laptopie i telefonie, potem adres Tailscale
                z listy.
              </div>
              <div>
                połączone telefony: {info.clients}
              </div>
            </>
          ) : (
            <>włącz, żeby telefon widział workspace’y z tego pq. laptop musi zostać włączony.</>
          )}
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            zamknij
          </button>
          {info.enabled ? (
            <>
              <button className="ghost" onClick={() => void window.pq.remote.regenPin().then(setInfo)}>
                nowy PIN
              </button>
              <button
                className="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setInfo(await window.pq.remote.stop())
                  setBusy(false)
                }}
              >
                wyłącz
              </button>
            </>
          ) : (
            <button
              className="primary"
              style={{ width: 'auto', padding: '0 18px', marginTop: 0 }}
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  setInfo(await window.pq.remote.start())
                } finally {
                  setBusy(false)
                }
              }}
            >
              włącz remote
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
