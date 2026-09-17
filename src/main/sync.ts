import { BrowserWindow } from './host'
import type { EngineId, EngineResult, SyncEvent } from '../shared/types'
import { ENGINE_SPECS } from './engines'
import { cliCapabilities } from './engine-manager'

export class EngineSync {
  last: SyncEvent = { running: false, line: '', done: 0, total: 0 }

  constructor(
    private getWin: () => BrowserWindow | null,
    private update: (id: EngineId) => Promise<EngineResult>
  ) {}

  private emit(partial: Partial<SyncEvent>): void {
    this.last = { ...this.last, ...partial }
    this.getWin()?.webContents.send('sync:event', this.last)
  }

  async start(): Promise<void> {
    if (this.last.running) return
    // Never install missing agents or mutate externally managed tools during sync.
    const specs = ENGINE_SPECS.filter((s) => cliCapabilities(s).managed)
    this.emit({ running: true, done: 0, total: specs.length, line: 'Aktualizacja CLI zarządzanych przez pqTERM…' })
    let failed = 0
    try {
      for (const spec of specs) {
        this.emit({ current: spec.id, line: `${spec.name} · aktualizacja…` })
        const result = await this.update(spec.id)
        if (!result.ok) failed++
        this.emit({ done: this.last.done + 1, line: result.message })
      }
    } catch (err) {
      failed++
      this.emit({ line: err instanceof Error ? err.message : String(err) })
    } finally {
      this.emit({ running: false, current: undefined, line: `Sync: ${this.last.done}/${specs.length}, błędy: ${failed}. Zewnętrzne instalacje pozostawiono bez zmian.` })
    }
  }
}
