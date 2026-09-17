import type { ProviderInfo } from '../../../shared/types'
import { isRawShell } from '../../../shared/types'
import EngineMark from './EngineMark'
import EngineActions, { EngineFeedback, useEngineActions, type EngineActionState } from './EngineActions'

export default function ProvidersModal({
  providers,
  email,
  onClose
}: {
  providers: ProviderInfo[]
  email?: string
  onClose: () => void
}) {
  const actions = useEngineActions()
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>PROVIDERS / MODELS</h2>
        <div className="sub">
          skan lokalnych CLI i plików auth. konto: <b>{email ?? '—'}</b>. zaznacz domyślne silniki
          dla nowych prac; wszystkie CLI są dostępne w Spawn Engine.
        </div>
        <div className="modal-actions" style={{ marginTop: 0, marginBottom: 12, justifyContent: 'flex-start' }}>
          <button className="ghost" disabled={!!actions.pending} onClick={() => void window.pq.providers.scan().catch(actions.report)}>
            re-scan
          </button>
        </div>
        <EngineFeedback actions={actions} />
        {providers
          .filter((p) => !isRawShell(p.id))
          .map((p) => (
            <ProviderCard key={p.id} p={p} email={email} actions={actions} />
          ))}
        <div className="modal-actions">
          <button className="primary" style={{ width: 'auto', padding: '0 18px', marginTop: 0 }} onClick={onClose}>
            done
          </button>
        </div>
      </div>
    </div>
  )
}

function ProviderCard({ p, email, actions }: { p: ProviderInfo; email?: string; actions: EngineActionState }) {
  const matched = email && p.matchedEmail && p.matchedEmail === email.toLowerCase()
  return (
    <div className="prov">
      <div className="prov-top">
        <button
          className={p.enabled ? 'switch on' : 'switch'}
          onClick={() => void window.pq.providers.setEnabled(p.id, !p.enabled).catch(actions.report)}
          aria-label={`enable ${p.name}`}
        >
          <i />
        </button>
        <EngineMark id={p.id} name={p.name} color={p.color} logo={p.logo} icon={p.icon} mark={p.mark} size={34} />
        <div className="nm">
          <b style={{ color: p.color }}>{p.name}</b>
          <div className="hint" style={{ marginTop: 2 }}>
            {p.vendor} · {p.resolvedPath ?? p.command}
          </div>
        </div>
        {p.installed ? <span className="badge ok">installed</span> : <span className="badge">missing</span>}
        {p.detectedAuth ? <span className="badge ok">auth</span> : <span className="badge warn">no auth</span>}
        {matched ? <span className="badge ok">email match</span> : null}
      </div>
      {p.models.length > 0 && (
        <div className="models">
          {p.models.map((m) => (
            <label key={m.id} className="check">
              <input
                type="checkbox"
                checked={m.enabled}
                onChange={() => void window.pq.providers.setModel(p.id, m.id, !m.enabled).catch(actions.report)}
              />
              {m.name}
            </label>
          ))}
        </div>
      )}
      <EngineActions provider={p} actions={actions} />
    </div>
  )
}
