import { test } from 'node:test'
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { BoardHub } from './board.ts'
import type { BoardSnapshot } from '../shared/types.ts'

test('BoardHub drops in-flight git results after detach or reattach', async (t) => {
  for (const destination of ['detached', 'other-workspace', 'same-workspace']) {
    await t.test(destination, async (t) => {
      const root = mkdtempSync(join(tmpdir(), 'pq-board-'))
      const first = join(root, 'first')
      const next = destination === 'same-workspace' ? first : join(root, 'next')
      const requests: Array<{ cwd: string; finish: (err: null, stdout: string) => void }> = []
      t.mock.method(childProcess, 'execFile', (_file, _args, options, callback) => {
        requests.push({ cwd: options.cwd, finish: callback })
      })
      syncBuiltinESMExports()
      t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
      const board = new BoardHub()
      const snapshots: BoardSnapshot[] = []
      board.setListener((snapshot) => snapshots.push(snapshot))
      t.after(() => {
        board.detach()
        t.mock.restoreAll()
        syncBuiltinESMExports()
        rmSync(root, { recursive: true, force: true })
      })

      board.attach(first)
      board.paneStart('old-pane', 'omp', 'old')
      board.detach()
      if (destination !== 'detached') {
        board.attach(next)
        board.paneStart('new-pane', 'omp', 'new')
      }
      assert.equal(requests[0].cwd, first)
      requests[0].finish(null, ' M old.ts\n')
      await setImmediate()
      assert.equal(board.snapshot(), null)
      assert.deepEqual(snapshots, [])
      assert.equal(existsSync(join(first, '.pq', 'BOARD.md')), false)
      assert.equal(existsSync(join(first, '.pq', 'board.json')), false)
      assert.equal(existsSync(join(next, '.pq', 'BOARD.md')), false)
      assert.equal(existsSync(join(next, '.pq', 'board.json')), false)

      t.mock.timers.tick(250)
      await setImmediate()
      if (destination === 'detached') {
        assert.equal(requests.length, 1)
        return
      }
      assert.equal(requests.length, 2)
      assert.equal(requests[1].cwd, next)
      requests[1].finish(null, ' M new.ts\n')
      await setImmediate()
      assert.equal(snapshots.length, 1)
      assert.equal(snapshots[0].cwd, next)
      assert.deepEqual(snapshots[0].git, ['M new.ts'])
      assert.deepEqual(snapshots[0].panes.map((pane) => pane.paneId), ['new-pane'])
      const persisted = JSON.parse(readFileSync(join(next, '.pq', 'board.json'), 'utf8'))
      assert.deepEqual(persisted, snapshots[0])
      assert.match(readFileSync(join(next, '.pq', 'BOARD.md'), 'utf8'), /new\.ts/)
    })
  }
})
