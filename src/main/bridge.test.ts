import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CTL } from './pqterm-ctl.ts'
// The installed `pqterm` command is this CTL blob — `pqterm update` must
// reach the updater shipped next to it (pqterm-update.cjs), forwarding
// arguments and the exit code — not fall through to the grid help.
test('pqterm update spawns the updater next to the ctl', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pq-ctl-'))
  try {
    writeFileSync(join(dir, 'pqterm-ctl.cjs'), CTL, 'utf8')
    writeFileSync(
      join(dir, 'bridge.json'),
      JSON.stringify({ updater: join(dir, 'pqterm-update.cjs') }),
      'utf8'
    )
    writeFileSync(
      join(dir, 'pqterm-update.cjs'),
      'console.log("updater-ran", process.argv.slice(2).join(","))\nprocess.exit(3)\n',
      'utf8'
    )
    const r = spawnSync(process.execPath, [join(dir, 'pqterm-ctl.cjs'), 'update', '--check'], {
      encoding: 'utf8'
    })
    assert.equal(r.status, 3, 'exit code must forward from the updater')
    assert.match(r.stdout, /updater-ran update,--check/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pqterm update without the updater says so and exits 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pq-ctl-'))
  try {
    writeFileSync(join(dir, 'pqterm-ctl.cjs'), CTL, 'utf8')
    writeFileSync(join(dir, 'bridge.json'), '{}', 'utf8')
    const r = spawnSync(process.execPath, [join(dir, 'pqterm-ctl.cjs'), 'update'], {
      encoding: 'utf8'
    })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /brak skryptu aktualizacji/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unknown pqterm command still prints the grid help', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pq-ctl-'))
  try {
    writeFileSync(join(dir, 'pqterm-ctl.cjs'), CTL, 'utf8')
    const r = spawnSync(process.execPath, [join(dir, 'pqterm-ctl.cjs'), 'nope'], {
      encoding: 'utf8'
    })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /sterowanie siatką/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
