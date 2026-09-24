import { useState } from 'react'
import type { NotificationSettings } from '../../../shared/types'

/**
 * Desktop-alert switches. Sits in the Settings modal (tab "powiadomienia") and
 * applies straight away — the snapshot that comes back over `state:changed` is
 * the single source for the checkboxes.
 */
export default function NotificationsPanel({ settings }: { settings: NotificationSettings }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(next: NotificationSettings): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await window.pq.notifications.set(next)
    } catch (cause) {
      console.error('[pqTERM] notification settings failed', cause)
      setError('Nie udało się zapisać ustawień. Spróbuj ponownie.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="sub">
        Alert systemowy dla terminala poza fokusem: sygnał BEL oznacza prośbę CLI o uwagę,
        a zakończenie procesu informuje o wyjściu z sesji. Kliknięcie alertu otwiera właściwy
        terminal. Cisza w wyjściu CLI nie oznacza ukończenia zadania. Alert „czeka na Ciebie”
        dostajesz tylko z okna, do którego coś wpisałeś — świeże, nietknięte okno nigdy nie
        alarmuje. Statusy w pqTERM pozostają widoczne także po wyłączeniu alertów.
      </div>
      <label className="check">
        <input type="checkbox" checked={settings.enabled} disabled={busy}
          onChange={(e) => void save({ ...settings, enabled: e.target.checked })} />
        Powiadomienia systemowe
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.sound} disabled={busy || !settings.enabled}
          onChange={(e) => void save({ ...settings, sound: e.target.checked })} />
        Dźwięk powiadomienia
      </label>
      <p className="hint">
        Wyświetlanie i dźwięk zależą też od ustawień powiadomień i trybu „Nie przeszkadzać” w systemie.
      </p>
      {error ? <p role="alert" className="notification-error">{error}</p> : null}
    </>
  )
}
