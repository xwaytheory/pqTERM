import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
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

test('pqterm handoff posts the slot and engine, and prints the checkpoint path', async () => {
  const { createServer } = await import('node:http')
  const dir = mkdtempSync(join(tmpdir(), 'pq-ctl-'))
  let seen = ''
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen = `${req.method} ${req.url} ${body}`
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, checkpoint: 'C:/sessions/s1/checkpoint.1.md' }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  try {
    writeFileSync(join(dir, 'pqterm-ctl.cjs'), CTL, 'utf8')
    writeFileSync(
      join(dir, 'bridge.json'),
      JSON.stringify({ origin: `http://127.0.0.1:${port}`, token: 't' }),
      'utf8'
    )
    // spawnSync would block this process's event loop and the fake bridge could never answer
    const r = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const env = { ...process.env }
      // an outer pqTERM pane exports its own bridge — the test must use the fake one
      delete env.PQ_BRIDGE
      delete env.PQ_TOKEN
      const child = spawn(process.execPath, [join(dir, 'pqterm-ctl.cjs'), 'handoff', '2', 'codebuddy'], {
        env
      })
      let out = ''
      child.stdout.on('data', (c) => (out += c))
      child.stderr.on('data', (c) => (out += `\nERR: ${c}`))
      child.on('exit', (code) => resolve({ code, out }))
    })
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /checkpoint\.1\.md/)
    assert.match(seen, /^POST \/v1\/session\/handoff/)
    assert.match(seen, /"slot":2/)
    assert.match(seen, /"engine":"codebuddy"/)
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pqterm handoff without arguments refuses instead of guessing a slot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pq-ctl-'))
  try {
    writeFileSync(join(dir, 'pqterm-ctl.cjs'), CTL, 'utf8')
    const r = spawnSync(process.execPath, [join(dir, 'pqterm-ctl.cjs'), 'handoff'], { encoding: 'utf8' })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /pqterm handoff <slot> <engine>/)
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
