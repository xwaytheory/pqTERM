import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// This test exercises native Node loading of the main-process title module.
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes('/pane-title.ts')) {
      if (specifier === './osc-title') return nextResolve('./osc-title.ts', context)
      if (specifier === '../shared/types') return nextResolve('../shared/types.ts', context)
    }
    return nextResolve(specifier, context)
  }
`)}`, import.meta.url)
const { adoptAutoTitle, updatePaneTitle } = await import('./pane-title.ts')

const pane = { id: 'pane', engine: 'omp' as const, title: 'Własny tytuł', titleLocked: true }
const cli = { id: 'omp', name: 'Omp' }

test('manual pane title survives an automatic engine/title patch', () => {
  const next = updatePaneTitle(pane, { engine: 'opencode', title: 'OpenCode' }, 'OpenCode')
  assert.equal(next.title, 'Własny tytuł')
  assert.equal(next.titleLocked, true)
  assert.equal(next.engine, 'opencode')
})

test('manual pane title can still be changed explicitly', () => {
  const next = updatePaneTitle(pane, { title: 'Nowy tytuł', titleLocked: true }, 'Omp')
  assert.equal(next.title, 'Nowy tytuł')
})

test('unlocked pane follows the CLI title and can be unlocked explicitly', () => {
  const auto = { ...pane, title: 'Omp', titleLocked: false }
  const next = updatePaneTitle(auto, { engine: 'opencode', title: 'OpenCode' }, 'OpenCode')
  assert.equal(next.title, 'OpenCode')
  assert.equal(next.titleLocked, false)
  const unlocked = updatePaneTitle(pane, { title: 'Omp', titleLocked: false }, 'Omp')
  assert.equal(unlocked.titleLocked, false)
})

test('CLI title is adopted only in automatic mode', () => {
  assert.equal(adoptAutoTitle({ ...pane, titleLocked: false, title: 'Omp' }, 'omp: session', cli, 'Omp').title, 'session')
  assert.equal(adoptAutoTitle(pane, 'omp: session', cli, 'Omp').title, 'Własny tytuł')
})
