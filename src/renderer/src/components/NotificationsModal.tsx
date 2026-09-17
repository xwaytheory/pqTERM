import { useEffect, useRef, useState } from 'react'
import type { NotificationSettings } from '../../../shared/types'

export default function NotificationsModal({
  settings,
  onClose
}: {
  settings: NotificationSettings
  onClose: () => void
}) {
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])

  async function save(): Promise<void> {
    setSaving(true)
    setError('')
    try {
      await window.pq.notifications.set(draft)
      onClose()
    } catch (cause) {
      console.error('[pqTERM] notification settings failed', cause)
      setError('Nie udało się zapisać ustawień. Spróbuj ponownie.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-back" onClick={() => { if (!saving) onClose() }}>
      <div
        ref={dialog}
        className="modal notification-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-title"
        aria-describedby="notifications-description"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !saving) {
            e.stopPropagation()
            onClose()
          }
          if (e.key !== 'Tab') return
          const controls = dialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')
          if (!controls?.length) { e.preventDefault(); return }
          const first = controls[0]
          const last = controls[controls.length - 1]
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
        }}
      >
        <h2 id="notifications-title">POWIADOMIENIA</h2>
        <div className="sub" id="notifications-description">
          Alert systemowy dla terminala poza fokusem: sygnał BEL oznacza prośbę CLI o uwagę,
          a zakończenie procesu informuje o wyjściu z sesji. Kliknięcie alertu otwiera właściwy terminal.
          Cisza w wyjściu CLI nie oznacza ukończenia zadania. Statusy w pqTERM pozostają widoczne
          także po wyłączeniu alertów.
        </div>
        <label className="check">
          <input type="checkbox" checked={draft.enabled} disabled={saving}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
          Powiadomienia systemowe
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.sound} disabled={saving || !draft.enabled}
            onChange={(e) => setDraft({ ...draft, sound: e.target.checked })} />
          Dźwięk powiadomienia
        </label>
        <p className="hint">Wyświetlanie i dźwięk zależą też od ustawień powiadomień i trybu „Nie przeszkadzać” w systemie.</p>
        {error ? <p role="alert" className="notification-error">{error}</p> : null}
        <div className="modal-actions">
          <button className="ghost" disabled={saving} onClick={onClose}>anuluj</button>
          <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'zapisywanie…' : 'zapisz'}</button>
        </div>
      </div>
    </div>
  )
}
