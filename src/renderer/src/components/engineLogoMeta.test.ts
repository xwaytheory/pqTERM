import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENGINE_ORDER } from '../../../shared/types.ts'
import { ENGINE_LOGO_FILES, ENGINE_LOGO_IDS } from './engineLogoMeta.ts'

const here = dirname(fileURLToPath(import.meta.url))

test('every engine has a built-in logo slot', () => {
  const have = new Set<string>([...ENGINE_LOGO_IDS])
  for (const id of ENGINE_ORDER) {
    assert.ok(have.has(id), `missing built-in logo for engine ${id}`)
  }
})

test('logo list has no unknown engine ids', () => {
  const known = new Set<string>(ENGINE_ORDER)
  for (const id of ENGINE_LOGO_IDS) {
    assert.ok(known.has(id), `logo slot for unknown engine ${id}`)
  }
})

test('every logo slot has a file on disk', () => {
  for (const id of ENGINE_LOGO_IDS) {
    const file = ENGINE_LOGO_FILES[id]
    assert.ok(file, `no file mapped for engine ${id}`)
    const abs = join(here, '..', 'assets', 'engines', file)
    assert.ok(existsSync(abs), `missing logo asset ${abs}`)
  }
})
