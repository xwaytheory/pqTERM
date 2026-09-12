import { useEffect, useRef, useState } from 'react'
import type { AppSnapshot } from '../../../shared/types'
import {
  isListening,
  onVoice,
  runText,
  startListening,
  stopListening,
  transcribe,
  type VoiceEvent,
  type VoiceLogLine,
  type VoicePhase
} from '../lib/voiceCommander'

const PHASE_LABEL: Record<VoicePhase, string> = {
  idle: 'gotowe',
  listen: 'słucham…',
  transcribe: 'transkrybuję…',
  run: 'wykonuję…'
}

export default function VoicePanel({
  snap,
  focus,
  onClose
}: {
  snap: AppSnapshot
  focus: string | null
  onClose: () => void
}) {
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [level, setLevel] = useState(0)
  const [logs, setLogs] = useState<VoiceLogLine[]>([])
  const [transcript, setTranscript] = useState('')
  const [busy, setBusy] = useState(false)
  const logsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = onVoice((e: VoiceEvent) => {
      if (e.t === 'phase') setPhase(e.phase)
      else if (e.t === 'level') setLevel(e.v)
      else if (e.t === 'log') setLogs((ls) => [...ls.slice(-60), e.line])
      else if (e.t === 'result') setTranscript(e.text)
    })
    return off
  }, [])

  useEffect(() => {
    const el = logsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  const listening = isListening()

  async function handleMic(): Promise<void> {
    if (listening) {
      stopListening()
      return
    }
    if (busy) return
    setBusy(true)
    setLevel(0)
    try {
      const rec = await startListening()
      if (rec.status !== 'stopped' || !rec.audio) return
      setPhase('transcribe')
      const text = await transcribe(rec.audio)
      setTranscript(text)
      if (text.trim()) await runText(text.trim(), snap, focus)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLogs((ls) => [
        ...ls.slice(-60),
        { id: Date.now(), kind: 'error', text: msg }
      ])
    } finally {
      setLevel(0)
      setPhase('idle')
      setBusy(false)
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>MOWA</h2>
        <div className="sub">
          mów, a pq zrobi — dyktuj prompt do okna albo „…w pozostałych oknach: …”.
        </div>

        <div className="voice-stage">
          <button
            className={listening ? 'mic rec' : 'mic'}
            disabled={busy && !listening}
            onClick={() => void handleMic()}
            title={listening ? 'stop' : 'mów'}
          >
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <rect x="9" y="2.5" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <line x1="12" y1="18" x2="12" y2="21.5" />
            </svg>
          </button>
          <div className="voice-state">
            <b className={listening ? 'live' : ''}>{PHASE_LABEL[phase]}</b>
            <div className="meter">
              <i style={{ transform: `scaleX(${listening ? Math.max(0.04, level) : 0})` }} />
            </div>
          </div>
        </div>

        <div className="voice-log" ref={logsRef}>
          {logs.length === 0 ? (
            <span className="dim">tu pojawią się transkrypcje i wykonane akcje</span>
          ) : (
            logs.map((l) => (
              <div key={l.id} className={`vl vl-${l.kind}`}>
                <span className="vl-ico">{l.kind === 'error' ? '!' : l.kind === 'status' ? '·' : '›'}</span>
                <span>
                  {l.text}
                  {l.sub ? <em> — {l.sub}</em> : null}
                </span>
              </div>
            ))
          )}
        </div>

        {transcript ? (
          <div className="voice-edit">
            <textarea
              spellCheck={false}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="popraw transkrypcję…"
            />
            <div className="voice-edit-actions">
              <button className="ghost" disabled={busy} onClick={() => setTranscript('')}>
                wyczyść
              </button>
              <button
                className="primary"
                disabled={busy || !transcript.trim()}
                onClick={() => void runText(transcript.trim(), snap, focus)}
              >
                wykonaj poprawkę
              </button>
            </div>
          </div>
        ) : null}

        <div className="hint">
          przykłady: „napisz testy do modułu auth”, „wyślij w pozostałych oknach: uruchom build”,
          „utwórz workspace beta w katalogu C:{'\\'}projekt z trzema oknami opencode”
        </div>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            zamknij
          </button>
        </div>
      </div>
    </div>
  )
}