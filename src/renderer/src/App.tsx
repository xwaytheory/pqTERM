import { useEffect, useState } from 'react'
import type { AppSnapshot, SyncEvent } from '../../shared/types'
import LoginScreen from './screens/LoginScreen'
import DeckScreen from './screens/DeckScreen'

export default function App() {
  const [snap, setSnap] = useState<AppSnapshot | null>(null)
  const [boot, setBoot] = useState('connecting to main process…')
  const [sync, setSync] = useState<SyncEvent>({ running: false, line: '', done: 0, total: 0 })

  useEffect(() => {
    let off: (() => void) | undefined
    let offSync: (() => void) | undefined
    ;(async () => {
      try {
        setBoot('loading state…')
        const s = await window.pq.state.load()
        setSnap(s)
        off = window.pq.state.onChange(setSnap)
        const last = await window.pq.sync.last()
        setSync(last)
        offSync = window.pq.sync.onEvent(setSync)
      } catch (err) {
        setBoot(String(err))
      }
    })()
    return () => {
      off?.()
      offSync?.()
    }
  }, [])

  if (!snap) {
    return (
      <div className="app">
        <div className="blank">
          <div>
            pq
            <br />
            {boot}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {sync.running || sync.line ? (
        <div className={sync.running ? 'syncbar' : 'syncbar dim'}>
          <span>{sync.line || 'pq · idle'}</span>
          {sync.total > 0 ? (
            <span>
              {sync.done}/{sync.total}
            </span>
          ) : null}
        </div>
      ) : null}
      {snap.user ? <DeckScreen snap={snap} /> : <LoginScreen snap={snap} />}
    </div>
  )
}
