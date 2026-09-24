import { useState } from 'react'
import type { AppSnapshot } from '../../../shared/types'
import Titlebar from '../components/Titlebar'
import brandMark from '../assets/brand-mark.png'

export default function LoginScreen({ snap }: { snap: AppSnapshot }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState(snap.google.clientId)
  const [clientSecret, setClientSecret] = useState(snap.google.clientSecret)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [showCfg, setShowCfg] = useState(false)

  function prettyError(e: unknown): string {
    const m = e instanceof Error ? e.message : String(e)
    return m
      .replace(/^Error invoking remote method '[^']+': (Error: )?/i, '')
      .replace(/electron/gi, 'pq')
  }

  async function google() {
    setErr('')
    setBusy(true)
    try {
      if (clientId !== snap.google.clientId || clientSecret !== snap.google.clientSecret) {
        await window.pq.auth.saveGoogleConfig({ clientId, clientSecret })
      }
      await window.pq.auth.google()
    } catch (e) {
      setErr(prettyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function local() {
    setErr('')
    setBusy(true)
    try {
      await window.pq.auth.local(email, name)
    } catch (e) {
      setErr(prettyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Titlebar />
      <div className="login">
        <div className="login-left">
          <img className="brand-logo" src={brandMark} alt="pqTERM" />
          <p className="lead">
            command deck dla agentów AI. workspace po lewej, siatka terminali po prawej. grok, omp,
            hermes, opencode, codex, claude code — prawdziwe TUI w ConPTY, na twoim dysku.
          </p>
          <div className="boot">
            <div>
              <span className="g">ok</span> conpty ready
            </div>
            <div>
              <span className="g">ok</span> engines: grok · omp · hermes · opencode · codex · claude
            </div>
            <div>
              <span className="g">ok</span> grid 1–9 panes
            </div>
            <div>waiting for identity…</div>
          </div>
        </div>
        <div className="login-right">
          <div className="card">
            <h2>sign in</h2>
            <div className="sub">
              kliknij Continue with Google — otworzy się okno logowania Google. po wyborze konta
              pq przeskanuje lokalne sesje grok / opencode / hermes / claude / codex / omp.
            </div>
            <button className="google" disabled={busy} onClick={google}>
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path
                  fill="#FFC107"
                  d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.1-3.5 5.6-6.7 7.1l6.3 5.3C37.3 38.3 44 33 44 24c0-1.2-.1-2.3-.4-3.5z"
                />
              </svg>
              {busy ? 'connecting…' : 'Continue with Google'}
            </button>

            <div className="or">opcjonalnie</div>
            <button className="ghost" onClick={() => setShowCfg((v) => !v)}>
              {showCfg ? 'ukryj OAuth client' : 'własny Google OAuth client'}
            </button>
            {showCfg && (
              <>
                <label className="f">GOOGLE CLIENT ID</label>
                <input
                  className="f"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="xxxxx.apps.googleusercontent.com"
                />
                <label className="f">CLIENT SECRET (desktop, opcjonalnie)</label>
                <input
                  className="f"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="opcjonalnie"
                />
                <div className="hint">
                  Google Cloud Console → APIs & Services → Credentials → Create OAuth client → typ{' '}
                  <b>Desktop app</b>. W Authorized redirect URIs dodaj loopback{' '}
                  <code>http://127.0.0.1</code>. pq sam dobierze wolny port.
                </div>
              </>
            )}

            <div className="or">sesja lokalna</div>
            <label className="f">GMAIL / EMAIL</label>
            <input
              className="f"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@gmail.com"
            />
            <label className="f">NAZWA</label>
            <input
              className="f"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="operator"
            />
            <button className="primary" disabled={busy} onClick={local}>
              wejdź i skanuj providerów
            </button>
            {err ? <div className="err">{err}</div> : null}
            <div className="hint">
              Google nie udostępnia listy subskrypcji xAI / OpenCode / Hermes. pq wykrywa
              zainstalowane CLI i lokalne pliki auth; jeśli email z logowania zgadza się z emailem w
              konfiguracji agenta — provider włącza się sam. Zawsze możesz odznaczyć go w panelu
              PROVIDERS.
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
