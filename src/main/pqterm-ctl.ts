export const CTL = `const { readFileSync, existsSync } = require('fs')
const { join } = require('path')
const { spawn } = require('child_process')

function loadBridge() {
  if (process.env.PQ_BRIDGE && process.env.PQ_TOKEN) {
    return { origin: process.env.PQ_BRIDGE, token: process.env.PQ_TOKEN }
  }
  const f = join(__dirname, 'bridge.json')
  if (!existsSync(f)) {
    console.error('pq: brak mostka — odpal najpierw aplikację pq')
    process.exit(1)
  }
  return JSON.parse(readFileSync(f, 'utf8'))
}

async function call(method, path, body) {
  const b = loadBridge()
  const res = await fetch(b.origin + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-PQ-Token': b.token
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!res.ok) {
    console.error(json.error || text)
    process.exit(1)
  }
  return json
}

function help() {
  console.log(\`pqterm — sterowanie siatką z wnętrza CLI

  pqterm list
  pqterm fill [engine]              idle sloty → silnik (domyślnie grok)
  pqterm fill grok --send Siemanko  fill + ten sam prompt w nowych oknach
  pqterm spawn <slot> [engine]      slot 1..N
  pqterm send <slot> <tekst...>     wyślij prompt + Enter
  pqterm checkpoint [slot]          zapisz checkpoint sesji (domyślnie ten panel)
  pqterm handoff <slot> <engine>    przejmij zadanie w innym CLI (ten sam katalog)
  pqterm update [--check]         aktualizacja kopii (main/dev/test)
\`)
}

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    help()
    return
  }
  if (cmd === 'list') {
    const data = await call('GET', '/v1/panes')
    for (const p of data.panes) {
      const st = p.engine ? p.engine : 'idle'
      console.log(String(p.slot).padStart(2) + '  ' + st.padEnd(10) + '  ' + (p.title || ''))
    }
    return
  }
  if (cmd === 'fill') {
    const rest = argv.slice(1)
    const sendAt = rest.indexOf('--send')
    let engine = 'grok'
    let prompt = ''
    if (sendAt >= 0) {
      engine = rest[0] && rest[0] !== '--send' ? rest[0] : 'grok'
      prompt = rest.slice(sendAt + 1).join(' ')
    } else if (rest[0]) engine = rest[0]
    const skip = process.env.PQ_SLOT ? Number(process.env.PQ_SLOT) : 0
    const data = await call('POST', '/v1/fill', { engine, prompt, skipSlot: skip })
    console.log(data.ok ? 'ok  ' + (data.spawned || []).join(',') : 'fail')
    return
  }
  if (cmd === 'spawn') {
    const slot = Number(argv[1])
    const engine = argv[2] || 'grok'
    if (!slot) { console.error('pqterm spawn <slot> [engine]'); process.exit(1) }
    await call('POST', '/v1/panes/' + slot + '/spawn', { engine })
    console.log('ok')
    return
  }
  if (cmd === 'send') {
    const slot = Number(argv[1])
    const text = argv.slice(2).join(' ')
    if (!slot || !text) { console.error('pqterm send <slot> <tekst>'); process.exit(1) }
    await call('POST', '/v1/panes/' + slot + '/write', { text })
    console.log('ok')
    return
  }
  if (cmd === 'handoff') {
    const slot = Number(argv[1])
    const engine = argv[2]
    if (!slot || !engine) { console.error('pqterm handoff <slot> <engine>'); process.exit(1) }
    const data = await call('POST', '/v1/session/handoff', { slot, engine })
    console.log(data.checkpoint || 'ok (bez checkpointu)')
    if (data.reason) console.error('uwaga: ' + data.reason)
    return
  }
  if (cmd === 'checkpoint') {
    const slot = Number(argv[1]) || (process.env.PQ_SLOT ? Number(process.env.PQ_SLOT) : 0)
    if (!slot) { console.error('pqterm checkpoint [slot]'); process.exit(1) }
    const data = await call('POST', '/v1/session/checkpoint', { slot })
    console.log(data.path)
    return
  }
  if (cmd === 'update' || cmd === '--check') {
    let upd = ''
    try {
      upd = JSON.parse(readFileSync(join(__dirname, 'bridge.json'), 'utf8')).updater || ''
    } catch {
      console.error('pqterm update: brak bridge.json — odpal aplikację pqTERM (zapisze go przy starcie)')
      process.exit(1)
    }
    if (!upd || !existsSync(upd)) {
      console.error('pqterm update: brak skryptu aktualizacji — odpal aplikację pqTERM (zapisze go przy starcie)')
      process.exit(1)
    }
    const child = spawn(process.execPath, [upd, ...argv], { stdio: 'inherit' })
    child.on('exit', (code) => process.exit(code == null ? 0 : code))
    child.on('error', (e) => { console.error(String(e && e.message ? e.message : e)); process.exit(1) })
    return
  }
  help()
  process.exit(1)
}

main().catch((e) => { console.error(String(e && e.message ? e.message : e)); process.exit(1) })
`
