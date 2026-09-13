/**
 * Tiny smoke: voice-host shutdown lifecycle (no Electron, no real pq-voice.exe).
 * Run: node --experimental-strip-types src/main/voice-host.shutdown.smoke.ts
 */
import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'
import {
  shutdownVoiceHost,
  getActiveVoiceHost,
  setActiveVoiceHostForTest,
  encodeCancelLine,
  trySendCancelToActiveVoiceHost,
  VOICE_HOST_KILL_GRACE_MS
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

// 1) No active → no throw
setActiveVoiceHostForTest(null)
shutdownVoiceHost()
assert(getActiveVoiceHost() === null, 'expected null active after no-op shutdown')

// 2) Fake handle → kill path does not throw; clears active
const child = fakeChild()
setActiveVoiceHostForTest({
  child,
  sessionId: 'smoke1',
  transport: 'ipc-tcp',
  exe: 'fake-pq-voice.exe'
})
assert(getActiveVoiceHost()?.sessionId === 'smoke1', 'active should be set')
shutdownVoiceHost()
assert(getActiveVoiceHost() === null, 'active cleared after shutdown')
assert(child._sigs.length >= 1, 'expected at least one kill()')
assert(child._sigs[0] === undefined || child._sigs[0] === 'SIGTERM', `first kill soft, got ${child._sigs[0]}`)

// 3) Honesty: Cancel helper returns false (not sent)
assert(trySendCancelToActiveVoiceHost('x') === false, 'Cancel must not pretend success')
const line = encodeCancelLine('smoke1', 'app-quit')
assert(line.includes('"type":"cancel"'), 'cancel line type')
assert(line.includes('"session_id":"smoke1"'), 'cancel line session')

// 4) Second shutdown still no-op
shutdownVoiceHost()

console.log(
  JSON.stringify({
    ok: true,
    kills: child._sigs,
    graceMs: VOICE_HOST_KILL_GRACE_MS,
    cancelSent: false
  })
)

// Allow win32 SIGKILL timer to fire without keeping process if unref worked;
// for smoke we briefly wait so the path can run when platform is win32.
if (process.platform === 'win32') {
  await new Promise((r) => setTimeout(r, VOICE_HOST_KILL_GRACE_MS + 50))
  assert(child._sigs.includes('SIGKILL'), 'expected SIGKILL after grace on win32')
  console.log(JSON.stringify({ ok: true, afterGraceKills: child._sigs }))
}