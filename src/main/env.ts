import { execFileSync } from 'child_process'
import { app } from 'electron'

export function runningDev(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL) || process.env.PQ_MODE === 'dev'
}

export function productName(): 'pqTERM' | 'pqTERM-dev' {
  return runningDev() ? 'pqTERM-dev' : 'pqTERM'
}

export type EditionName = 'pqTERM' | 'pqTERM-dev' | 'pqTERM-test'
export type EditionId = 'pq' | 'dev' | 'test'

interface EditionMeta {
  edition: EditionId
  name: EditionName
  build: number
}

let editionCache: EditionMeta | null = null

/** Rozpoznaje worktree po gałęzi gita w korzeniu aplikacji.
 *  Na maszynie klienta bez gita → oficjalna edycja, zerowy licznik buildu. */
function resolveEdition(): EditionMeta {
  if (editionCache) return editionCache
  const fallback = productName()
  let edition: EditionId = fallback === 'pqTERM-dev' ? 'dev' : 'pq'
  let build = 0
  try {
    const root = app.getAppPath()
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true
    })
      .toString()
      .trim()
      .toLowerCase()
    edition = branch === 'dev' ? 'dev' : branch === 'test' ? 'test' : 'pq'
    build = Number.parseInt(
      execFileSync('git', ['rev-list', '--count', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true
      })
        .toString()
        .trim(),
      10
    )
  } catch {
    // maszyna klienta bez gita → oficjalna edycja, zerowy licznik
  }
  const name: EditionName =
    edition === 'dev' ? 'pqTERM-dev' : edition === 'test' ? 'pqTERM-test' : fallback
  editionCache = { edition, name, build: build || 0 }
  return editionCache
}

export function editionName(): EditionName {
  return resolveEdition().name
}

export function editionId(): EditionId {
  return resolveEdition().edition
}

/** Liczba commitów na HEAD — rośnie z KAŻDĄ zmianą, bez ruszania
 *  zsynchronizowanej wersji 1.1.6 (zero konfliktów przy dev→test→main). */
export function buildNumber(): number {
  return resolveEdition().build
}
