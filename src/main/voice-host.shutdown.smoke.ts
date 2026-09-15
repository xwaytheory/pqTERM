/**
 * Tiny smoke: voice-host shutdown + Cancel honesty + listen-before-spawn IPC.
 * Run: node --experimental-strip-types src/main/voice-host.shutdown.smoke.ts
 */
import { EventEmitter } from 'events'
import { createConnection, type Socket } from 'net'
import type { ChildProcess } from 'child_process'
import {
  shutdownVoiceHost,
  getActiveVoiceHost,
  setActiveVoiceHostForTest,
  encodeCancelLine,
  encodeStartListenLine,
  encodeHelloLine,
  encodeAckLine,
  trySendCancelToActiveVoiceHost,
  trySendStartListenToActiveVoiceHost,
  sendStartListen,
  ingestVoiceHostIpcLine,
  listenVoiceIpc,
  namedPipePath,
  sanitizePipeSessionId,
  buildVoiceHostArgs,
  isVoiceHostEnabled,
  VOICE_HOST_KILL_GRACE_MS,
  DEFAULT_TCP_ADDR,
  PROTOCOL_VERSION
} from './voice-host.ts'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function fakeChild(): ChildProcess & { _sigs: (string | undefined)[] } {
  const ee = new EventEmitter() as ChildProcess & {
    killed: boolean
    exitCode: number | null
    kill: (signal?: NodeJS.Signals | number) => boolean
    _sigs: (string | undefined)[]
  }
  ee.killed = false
  ee.exitCode = null
  ee._sigs = []
  ee.kill = (signal?: NodeJS.Signals | number) => {
    ee._sigs.push(typeof signal === 'number' ? String(signal) : signal)
    // Simulate still-alive after first kill so SIGKILL path can run on win32.
    if (signal === 'SIGKILL') {
      ee.killed = true
      ee.exitCode = 1
    }
    return true
  }
  return ee
}

function fakeWritableSocket(): Socket & { _chunks: string[] } {
  const ee = new EventEmitter() as Socket & {
    destroyed: boolean
    writable: boolean
    write: (data: string | Buffer, cb?: (err?: Error | null) => void) => boolean
    destroy: () => Socket
    _chunks: string[]
  }
  ee.destroyed = false
  ee.writable = true
  ee._chunks = []
  ee.write = (data: string | Buffer) => {
    ee._chunks.push(typeof data === 'string' ? data : data.toString('utf8'))
    return true
  }
  ee.destroy = () => {
    ee.destroyed = true
    ee.writable = false
    return ee
  }
  return ee
}


// 1) No active → no throw
setActiveVoiceHostForTest(null)
shutdownVoiceHost()
assert(getActiveVoiceHost() === null, 'expected null active after no-op shutdown')

// 2) Fake handle without socket → Cancel honest false; kill path clears active
const child = fakeChild()
setActiveVoiceHostForTest({
  child,
  sessionId: 'smoke1',
  lastStatus: null,
  lastTranscripts: [],
  transport: 'ipc-tcp',
  exe: 'fake-pq-voice.exe',
  server: null,
  socket: null
})
assert(getActiveVoiceHost()?.sessionId === 'smoke1', 'active should be set')
assert(trySendCancelToActiveVoiceHost('x') === false, 'Cancel must not pretend success without socket')
shutdownVoiceHost()
assert(getActiveVoiceHost() === null, 'active cleared after shutdown')
assert(child._sigs.length >= 1, 'expected at least one kill()')
assert(child._sigs[0] === undefined || child._sigs[0] === 'SIGTERM', `first kill soft, got ${child._sigs[0]}`)

// 3) Encode Cancel line matches Rust IpcMessage tag
const line = encodeCancelLine('smoke1', 'host-shutdown')
assert(line.includes('"type":"cancel"'), 'cancel line type')
assert(line.includes('"session_id":"smoke1"'), 'cancel line session')
assert(line.includes('"reason":"host-shutdown"'), 'cancel line reason')
assert(!line.endsWith('\n'), 'encodeCancelLine has no trailing newline')

// 4) Writable socket → Cancel returns true and writes JSON line + \n
const child2 = fakeChild()
const sock = fakeWritableSocket()
setActiveVoiceHostForTest({
  child: child2,
  sessionId: 'smoke2',
  lastStatus: null,
  lastTranscripts: [],
  transport: 'ipc-pipe',
  exe: 'fake-pq-voice.exe',
  server: null,
  socket: sock
})
assert(trySendCancelToActiveVoiceHost('peer-test') === true, 'Cancel should succeed with writable socket')
assert(sock._chunks.length === 1, 'expected one write')
assert(sock._chunks[0]!.endsWith('\n'), 'Cancel write must be a JSON line')
assert(sock._chunks[0]!.includes('"type":"cancel"'), 'written type cancel')
assert(sock._chunks[0]!.includes('"session_id":"smoke2"'), 'written session')
shutdownVoiceHost()
assert(getActiveVoiceHost() === null, 'cleared after socket shutdown')
assert(sock.destroyed, 'socket destroyed on shutdown')
assert(child2._sigs.length >= 1, 'kill after cancel')

// 5) Second shutdown still no-op
shutdownVoiceHost()

// 6) Gate still off by default
assert(isVoiceHostEnabled({}) === false, 'must stay disabled without flag')
assert(isVoiceHostEnabled({ enabled: true }) === true, 'explicit enabled works')

// 7) Pipe path contract (correct name — no listen-after-spawn race / wrong binding)
const san = sanitizePipeSessionId('sessA')
assert(san.ok && san.id === 'sessA', 'sanitize ok')
assert(namedPipePath('sessA') === '\\\\.\\pipe\\pq-voice-sessA', `pipe path got ${namedPipePath('sessA')}`)
const pipeArgs = buildVoiceHostArgs({ sessionId: 'sessA', preferPipe: true, platform: 'win32' })
assert(pipeArgs.ok && pipeArgs.transport === 'ipc-pipe', 'pipe transport')
assert(pipeArgs.ok && pipeArgs.args[0] === '--ipc-pipe' && pipeArgs.args[1] === 'sessA', 'pipe args')

// 8) TCP listen-before-spawn: host listens, peer connects, Cancel over real socket
{
  const tcpAddr = '127.0.0.1:47991'
  const bound = await listenVoiceIpc({
    transport: 'ipc-tcp',
    sessionId: 'tcp-smoke',
    tcpAddr
  })
  assert(bound.listenAddr === tcpAddr, 'listen addr')
  let peerSock: Socket | null = null
  bound.server.on('connection', (s) => {
    peerSock = s
  })
  const client = createConnection({ host: '127.0.0.1', port: 47991 })
  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve())
    client.once('error', reject)
  })
  // Wait briefly for server 'connection'
  for (let i = 0; i < 40 && !peerSock; i++) await new Promise((r) => setTimeout(r, 25))
  assert(peerSock, 'server should have peer socket after connect')

  const child3 = fakeChild()
  const got: string[] = []
  // Host writes Cancel on server-side socket → client receives the line.
  client.on('data', (buf) => got.push(buf.toString('utf8')))

  setActiveVoiceHostForTest({
    child: child3,
    sessionId: 'tcp-smoke',
    transport: 'ipc-tcp',
    exe: 'fake-pq-voice.exe',
    server: bound.server,
    socket: peerSock,
    listenAddr: tcpAddr,
    lastStatus: null,
    lastTranscripts: []
  })
  assert(trySendCancelToActiveVoiceHost('host-shutdown') === true, 'real socket Cancel')
  await new Promise((r) => setTimeout(r, 50))
  const joined = got.join('')
  assert(joined.includes('"type":"cancel"'), `cancel on wire: ${joined}`)
  assert(joined.includes('"session_id":"tcp-smoke"'), 'session on wire')
  assert(joined.endsWith('\n') || joined.includes('\n'), 'newline framing')

  shutdownVoiceHost()
  assert(getActiveVoiceHost() === null, 'tcp smoke cleared')
  try {
    client.destroy()
  } catch {
    /* ignore */
  }
}

// 9) Encode StartListen — defaults language=pl, timeout_ms=0; tag type snake_case
const sl = encodeStartListenLine('smoke-sl')
assert(sl.includes('"type":"start_listen"'), 'start_listen type')
assert(sl.includes('"session_id":"smoke-sl"'), 'start_listen session')
assert(sl.includes('"language":"pl"'), 'start_listen default language pl')
assert(sl.includes('"timeout_ms":0'), 'start_listen default timeout')
assert(!sl.endsWith('\n'), 'encodeStartListenLine has no trailing newline')
const slEn = encodeStartListenLine('smoke-sl', { language: 'en', timeoutMs: 1500 })
assert(slEn.includes('"language":"en"'), 'override language')
assert(slEn.includes('"timeout_ms":1500'), 'override timeout')

// 10) StartListen without socket → honest false
{
  const c = fakeChild()
  setActiveVoiceHostForTest({
    child: c,
    sessionId: 'sl-nosock',
    transport: 'ipc-tcp',
    exe: 'fake-pq-voice.exe',
    server: null,
    socket: null,
    lastStatus: null,
    lastTranscripts: []
  })
  assert(trySendStartListenToActiveVoiceHost() === false, 'StartListen must not pretend success without socket')
  assert(sendStartListen() === false, 'sendStartListen alias honest false')
  setActiveVoiceHostForTest(null)
}

// 11) StartListen requires Hello/Ack; then succeeds with writable socket
{
  const c = fakeChild()
  const sock = fakeWritableSocket()
  setActiveVoiceHostForTest({
    child: c,
    sessionId: 'sl-sock',
    transport: 'ipc-pipe',
    exe: 'fake-pq-voice.exe',
    server: null,
    socket: sock,
    lastStatus: null,
    lastTranscripts: [],
    handshakeOk: false
  })
  assert(trySendStartListenToActiveVoiceHost() === false, 'StartListen false before Hello/Ack')
  const h = getActiveVoiceHost()!
  ingestVoiceHostIpcLine(h, encodeHelloLine('pq-voice'))
  assert(h.handshakeOk === true, 'handshakeOk after Hello')
  assert(sock._chunks.some((x) => x.includes('"type":"ack"') && x.includes('"ok":true')), 'Ack written')
  assert(trySendStartListenToActiveVoiceHost() === true, 'StartListen after Hello/Ack')
  const sl = sock._chunks.find((x) => x.includes('"type":"start_listen"'))
  assert(!!sl && sl.endsWith('\n'), 'StartListen write must be a JSON line')
  assert(sl!.includes('"language":"pl"'), 'written default pl')
  assert(sl!.includes('"session_id":"sl-sock"'), 'written session')
  // encode helpers contract
  assert(encodeHelloLine('pq-voice').includes('"protocol":' + PROTOCOL_VERSION), 'hello protocol')
  assert(encodeAckLine(true, 'ok').includes('"type":"ack"'), 'ack type')
  setActiveVoiceHostForTest(null)
}

// 12) Status / Transcript reader — ingest + partial lines (no throw)
{
  const c = fakeChild()
  const sock = fakeWritableSocket()
  setActiveVoiceHostForTest({
    child: c,
    sessionId: 'stat1',
    transport: 'ipc-tcp',
    exe: 'fake-pq-voice.exe',
    server: null,
    socket: sock,
    lastStatus: null,
    lastTranscripts: []
  })
  const h = getActiveVoiceHost()!
  // Direct ingest
  ingestVoiceHostIpcLine(h, '{"type":"status","source":"pq-voice","state":"listening","session_id":"stat1"}')
  assert(h.lastStatus?.state === 'listening', 'lastStatus listening')
  assert(h.lastStatus?.source === 'pq-voice', 'lastStatus source')
  ingestVoiceHostIpcLine(h, '{"type":"transcript","session_id":"stat1","text":"czesc","lang":"pl","is_final":true}')
  assert(h.lastTranscripts.length === 1 && h.lastTranscripts[0]!.text === 'czesc', 'transcript kept')
  // Partial / garbage must not throw
  ingestVoiceHostIpcLine(h, '{not-json')
  ingestVoiceHostIpcLine(h, '')
  // Socket data path: split across chunks
  sock.emit('data', Buffer.from('{"type":"status","source":"pq-voice","state":"process'))
  sock.emit('data', Buffer.from('ing","session_id":"stat1"}\n'))
  assert(h.lastStatus?.state === 'processing', 'status via buffered data chunks')
  setActiveVoiceHostForTest(null)
}

// 13) TCP: peer sends Status; host StartListen over real duplex
{
  const tcpAddr = '127.0.0.1:47992'
  const bound = await listenVoiceIpc({
    transport: 'ipc-tcp',
    sessionId: 'tcp-sl',
    tcpAddr
  })
  let peerSock: Socket | null = null
  bound.server.on('connection', (s) => {
    peerSock = s
  })
  const client = createConnection({ host: '127.0.0.1', port: 47992 })
  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve())
    client.once('error', reject)
  })
  for (let i = 0; i < 40 && !peerSock; i++) await new Promise((r) => setTimeout(r, 25))
  assert(peerSock, 'tcp-sl peer')

  const childSl = fakeChild()
  const got: string[] = []
  client.on('data', (buf) => got.push(buf.toString('utf8')))

  setActiveVoiceHostForTest({
    child: childSl,
    sessionId: 'tcp-sl',
    transport: 'ipc-tcp',
    exe: 'fake-pq-voice.exe',
    server: bound.server,
    socket: peerSock,
    listenAddr: tcpAddr,
    lastStatus: null,
    lastTranscripts: [],
    lastStatus: null,
    lastTranscripts: [],
    handshakeOk: false
  })
  assert(sendStartListen({ language: 'pl', timeoutMs: 0 }) === false, 'StartListen false before Hello')
  // Peer (voice) sends Hello; host auto-Acks via ingest on socket data
  client.write(encodeHelloLine('pq-voice') + '\n')
  await new Promise((r) => setTimeout(r, 50))
  assert(getActiveVoiceHost()?.handshakeOk === true, 'handshake after peer Hello')
  assert(sendStartListen({ language: 'pl', timeoutMs: 0 }) === true, 'real socket StartListen after Hello')
  await new Promise((r) => setTimeout(r, 50))
  const joined = got.join('')
  assert(joined.includes('"type":"start_listen"'), `start_listen on wire: ${joined}`)
  assert(joined.includes('"language":"pl"'), 'pl on wire')

  // Peer → host Status (client writes, server-side socket receives)
  client.write('{"type":"status","source":"pq-voice","state":"ready","session_id":"tcp-sl"}\n')
  await new Promise((r) => setTimeout(r, 50))
  const h2 = getActiveVoiceHost()
  assert(h2?.lastStatus?.state === 'ready', `status from peer got ${h2?.lastStatus?.state}`)

  shutdownVoiceHost()
  assert(getActiveVoiceHost() === null, 'tcp-sl cleared')
  try { client.destroy() } catch { /* ignore */ }
}

console.log(
  JSON.stringify({
    ok: true,
    kills: child._sigs,
    graceMs: VOICE_HOST_KILL_GRACE_MS,
    defaultTcp: DEFAULT_TCP_ADDR,
    cancelWithoutSocket: false,
    cancelWithSocket: true,
    listenBeforeSpawn: true,
    startListenDefaultPl: true,
    startListenHonesty: true,
    helloAck: true,
    protocolVersion: PROTOCOL_VERSION,
    statusReader: true
  })
)

// Allow win32 SIGKILL timer to fire without keeping process if unref worked;
// for smoke we briefly wait so the path can run when platform is win32.
if (process.platform === 'win32') {
  await new Promise((r) => setTimeout(r, VOICE_HOST_KILL_GRACE_MS + 50))
  assert(child._sigs.includes('SIGKILL'), 'expected SIGKILL after grace on win32')
  console.log(JSON.stringify({ ok: true, afterGraceKills: child._sigs }))
}