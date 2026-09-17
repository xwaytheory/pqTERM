import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { RemoteClient } from './client.ts'

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []
  failSend = false

  constructor(_url: string) {
    Socket.instances.push(this)
  }

  send(data: string): void {
    if (this.failSend) throw new Error('send failed')
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
    this.onclose?.()
  }

  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) })
  }

  hello(): void {
    this.readyState = Socket.OPEN
    this.message({ e: 'hello', snapshot: { workspaces: [] } })
  }
}

function setup(t: TestContext): RemoteClient {
  Socket.instances = []
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const values = {
    WebSocket: Socket,
    location: { protocol: 'http:', host: 'localhost' }
  }
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
  const client = new RemoteClient()
  t.after(() => client.disconnect())
  return client
}

test('writes report offline until hello and report a synchronous send failure', async (t) => {
  const client = setup(t)
  assert.equal(client.write('pane', 'draft\r'), false)
  const connecting = client.connect('token')
  const socket = Socket.instances[0]
  socket.readyState = Socket.OPEN
  assert.equal(client.write('pane', 'draft\r'), false)
  socket.hello()
  await connecting
  assert.equal(client.write('pane', 'draft\r'), true)
  socket.failSend = true
  assert.equal(client.write('pane', 'retain this\r'), false)
  assert.equal(client.ready, false)
  assert.deepEqual(socket.sent.map((frame) => JSON.parse(frame).a), [['pane', 'draft\r']])
})

test('replacement rejects the old handshake and stale callbacks cannot close the new socket', async (t) => {
  const client = setup(t)
  const first = client.connect('first')
  const old = Socket.instances[0]
  const staleClose = old.onclose!
  const staleError = old.onerror!
  const staleMessage = old.onmessage!
  const rejected = assert.rejects(first, /offline/)
  const second = client.connect('second')
  const current = Socket.instances[1]
  current.hello()
  await second
  await rejected
  staleClose()
  staleError()
  staleMessage({ data: JSON.stringify({ e: 'hello', snapshot: {} }) })
  assert.equal(client.ready, true)
  assert.equal(client.write('pane', 'current\r'), true)
  assert.equal(old.readyState, 3)
  assert.equal(current.sent.length, 1)
  t.mock.timers.tick(60000)
  assert.equal(Socket.instances.length, 2)
})

test('disconnect rejects pending RPCs, reconnects once, and never replays commands', async (t) => {
  const client = setup(t)
  const connecting = client.connect('token')
  const old = Socket.instances[0]
  old.hello()
  await connecting
  const request = client.call('workspaces.select', ['workspace'])
  const rejected = assert.rejects(request, /offline/)
  assert.equal(client.write('pane', 'once\r'), true)
  const staleClose = old.onclose!
  old.close()
  staleClose()
  await rejected
  t.mock.timers.tick(2500)
  const current = Socket.instances[1]
  current.hello()
  await Promise.resolve()
  t.mock.timers.tick(60000)
  assert.equal(Socket.instances.length, 2)
  assert.deepEqual(current.sent, [])
  const next = client.call('workspaces.select', ['next'])
  const id = JSON.parse(current.sent[0]).id
  current.message({ id, ok: true, r: 'selected' })
  assert.equal(await next, 'selected')
  const pending = client.call('workspaces.select', ['last'])
  const stopped = assert.rejects(pending, /offline/)
  client.disconnect()
  await stopped
  t.mock.timers.tick(60000)
  assert.equal(Socket.instances.length, 2)
})

test('handshake timeout closes the attempt and cleanup cancels retries and the next handshake', async (t) => {
  const client = setup(t)
  const connecting = client.connect('token')
  const failed = assert.rejects(connecting, /timeout/)
  t.mock.timers.tick(20000)
  await failed
  assert.equal(Socket.instances[0].readyState, 3)
  assert.equal(client.ready, false)
  client.disconnect()
  t.mock.timers.tick(60000)
  assert.equal(Socket.instances.length, 1)
  const again = client.connect('token')
  const cancelled = assert.rejects(again, /offline/)
  client.disconnect()
  await cancelled
  t.mock.timers.tick(60000)
  assert.equal(Socket.instances.length, 2)
})
