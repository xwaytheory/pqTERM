import { useEffect, useRef, useState } from 'react'
import type { EngineOperation, EngineResult, ProviderInfo } from '../../../shared/types'

export interface EngineActionState {
  pending: string | null
  result: EngineResult | null
  run: (provider: ProviderInfo, action?: EngineOperation, after?: () => Promise<unknown>) => Promise<void>
  report: (error: unknown) => void
}

export function useEngineActions(): EngineActionState {
  const locked = useRef(false)
  const [pending, setPending] = useState<string | null>(null)
  const [result, setResult] = useState<EngineResult | null>(null)

  function report(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    setResult((previous) => ({ ok: false, message, log: [previous?.log, message].filter(Boolean).join('\n') }))
  }

  async function run(p: ProviderInfo, action?: EngineOperation, after?: () => Promise<unknown>) {
    if (locked.current) return
    locked.current = true
    setPending(`${p.name}: ${action ?? 'launch'}…`)
    setResult(null)
    try {
      if (action && (!p.cli?.[action] || (action === 'uninstall' && !p.cli.managed))) {
        throw new Error(p.cli?.reason ?? 'CLI management is unavailable for this engine.')
      }
      if (await window.pq.engines.busy()) throw new Error('Another CLI operation is in progress. Try again when it finishes.')
      if (action) {
        const outcome = await window.pq.engines[action](p.id)
        setResult(outcome)
        if (!outcome.ok) return
      }
      await after?.()
    } catch (error) {
      report(error)
    } finally {
      locked.current = false
      setPending(null)
    }
  }

  return { pending, result, run, report }
}

export default function EngineActions({ provider: p, actions }: { provider: ProviderInfo; actions: EngineActionState }) {
  const reason = !p.cli
    ? 'CLI management is unavailable in this host.'
    : p.installed && !p.cli.managed
      ? `External installation — pqTERM will not remove it.${p.cli.reason ? ` ${p.cli.reason}` : ''}`
      : p.cli.reason ?? (!p.installed && !p.cli.install ? 'One-click installation is unsupported.' : '')
  return (
    <div className="engine-actions">
      <div className="engine-action-buttons">
        {!p.installed && (
          <button className="ghost" disabled={!!actions.pending || !p.cli?.install} onClick={() => void actions.run(p, 'install')}>
            install
          </button>
        )}
        {p.cli?.managed && (
          <button className="ghost engine-uninstall" disabled={!!actions.pending || !p.cli.uninstall} onClick={() => void actions.run(p, 'uninstall')}>
            uninstall
          </button>
        )}
        {p.cli?.managed && <span className="engine-ownership">pqTERM managed</span>}
      </div>
      {reason && <div className="engine-reason">{reason}</div>}
    </div>
  )
}

export function EngineFeedback({ actions }: { actions: EngineActionState }) {
  const [copyStatus, setCopyStatus] = useState('')
  useEffect(() => setCopyStatus(''), [actions.result])
  async function copy() {
    try {
      await window.pq.terminals.clipboardWrite(actions.result?.log || actions.result?.message || '')
      setCopyStatus('Copied')
    } catch (error) {
      setCopyStatus(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <div className="engine-feedback">
      <div role="status" aria-live="polite" aria-atomic="true">
        {actions.pending && <div>{actions.pending}</div>}
        {actions.result && <div className={actions.result.ok ? 'engine-success' : 'err'}>{actions.result.message}</div>}
      </div>
      {actions.result && (
        <details>
          <summary>operation log</summary>
          <button className="ghost" onClick={() => void copy()}>copy log</button>
          <span role="status" aria-live="polite">{copyStatus}</span>
          <pre>{actions.result.log || actions.result.message}</pre>
        </details>
      )}
    </div>
  )
}
