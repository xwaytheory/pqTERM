// Parity guard: parseGridIntent used to carry its own hand-maintained engine
// list that silently drifted from ENGINE_ORDER (it missed 'cline' and 'shell',
// so those engines could never be picked out of a typed grid command).
// One source of truth: every engine in ENGINE_ORDER must parse from a line.
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ENGINE_ORDER, parseGridIntent } from './types.ts'

for (const id of ENGINE_ORDER) {
  test(`parseGridIntent recognizes '${id}'`, () => {
    // "pozostałym" arms the sibling-panes trigger, so the intent is not null.
    const intent = parseGridIntent(`${id} napisz: fix X pozostałym`)
    assert.ok(intent, `${id}: intent parsed`)
    assert.equal(intent.engine, id)
  })
}
