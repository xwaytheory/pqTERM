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
        Alert systemowy dla terminala poza fokusem. Sposoby, w jakie pqTERM dowiaduje się, że
        potrzebujesz: sygnał BEL — ale tylko jeśli terminal po nim <em>zamilknął</em> (BEL w trakcie
        pracy CLI to szum, nie prośba), powiadomienia OSC 9 / 99 / 777 wysyłane przez CLI oraz —
        dla CLI, które nic nie wysyłają albo mają to wyłączone — rozpoznanie zatrzymanego pytania
        (np. „Do you want to proceed?”, <code>[y/n]</code>). Sama cisza i puste pole na dole
        ekranu niczego nie znaczą: pracujący agent też je pokazuje. Kliknięcie alertu otwiera
        właściwy terminal. Statusy w pqTERM pozostają widoczne także po wyłączeniu alertów.
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
      <p className="hint">
        Niektóre CLI mają własny wyłącznik i trzymają go domyślnie na off — wtedy zostaje tylko
        rozpoznanie pytania z ekranu: <code>attention.enabled</code> w opencode,
        <code> general.enableNotifications</code> w Gemini, <code>display.bell_on_*</code> w Hermes.
        Codex dodatkowo <code>notification_condition = &quot;always&quot;</code>, bo pane nigdy nie zgłasza utraty fokusu.
      </p>
      {error ? <p role="alert" className="notification-error">{error}</p> : null}
    </>
  )
}
