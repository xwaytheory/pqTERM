import { useEffect, useState } from 'react'
import type { RemoteInfo } from '../../../shared/types'

export default function RemotePanel({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')

  async function refresh() {
    setInfo(await window.pq.remote.info())
  }

  useEffect(() => {
    void refresh()
    return window.pq.remote.onChange(setInfo)
  }, [])

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      setTimeout(() => setCopied(''), 1200)
    } catch {
      /* ignore */
    }
  }

  if (!info) return null

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>TELEFON</h2>
        <div className="sub">
          telefon widzi te same workspace’y co ten laptop. wybierasz okno, piszesz prompt — wykonuje
          się tutaj, na żywo.
        </div>
        <div className="hint">
          {info.enabled ? (
            <>
              <div>
                most:{' '}
                {info.tunnel === 'up' && info.wanUrl ? (
                  <b style={{ color: 'var(--green)' }}>live</b>
                ) : info.tunnel === 'starting' ? (
                  'stawiam…'
                ) : info.tunnel === 'error' ? (
                  <span style={{ color: 'var(--red)' }}>{info.tunnelError || 'padł'}</span>
                ) : (
                  'wyłączony'
                )}
              </div>
              <div style={{ marginTop: 14 }}>
                PIN{' '}
                <b style={{ color: 'var(--green)', fontSize: 22, letterSpacing: '0.2em' }}>{info.pin}</b>
              </div>
              {info.wanUrl ? (
                <button
                  className="ghost"
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    marginTop: 12,
                    padding: '10px 12px',
                    wordBreak: 'break-all'
                  }}
                  onClick={() => void copy(info.wanUrl || '')}
                >
                  <code>{info.wanUrl}</code>
                  <div className="sub">{copied === info.wanUrl ? 'skopiowane' : 'kliknij — wklej to w apce'}</div>
                </button>
              ) : (
                <div style={{ marginTop: 10 }}>czekam na publiczny adres…</div>
              )}
              <div style={{ marginTop: 12 }}>
                1. w apce pq na telefonie wklej adres i PIN.
                <br />
                2. zobaczysz te same workspace’y.
                <br />
                3. wejdź w okno, napisz, send — leci tutaj.
              </div>
              <div style={{ marginTop: 10 }}>laptop i pq zostają włączone. telefony: {info.clients}</div>
            </>
          ) : (
            <>włącz most. dostaniesz adres i PIN. telefon łączy się z dowolnego miejsca.</>
          )}
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            zamknij
          </button>
          {info.enabled ? (
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
              włącz telefon
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
