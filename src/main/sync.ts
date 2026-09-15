import { execFile } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { BrowserWindow } from './host'
import type { EngineId, SyncEvent } from '../shared/types'
import { ENGINE_SPECS, specById, type EngineSpec } from './engines'
import { knownLaunch, resolveLaunch, sanitizeEnv } from './resolve-launch'

function npmCmd(): string {
  return join(homedir(), 'AppData', 'Roaming', 'npm', 'npm.cmd')
}

function q(s: string): string {
  if (/[\s"]/.test(s)) return `"${s.replace(/"/g, '\\"')}"`
  return s
}

function lastLine(text: string): string {
  const clean = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '')
  const lines = clean
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return lines[lines.length - 1] || ''
}

function run(
  file: string,
  args: string[],
  timeout = 180000
): Promise<{ ok: boolean; text: string }> {
  let exec = file
  let execArgs = args
  if (/\.(cmd|bat)$/i.test(file)) {
    exec = process.env.ComSpec || 'cmd.exe'
    execArgs = ['/d', '/s', '/c', [q(file), ...args.map(q)].join(' ')]
  }
  return new Promise((resolve) => {
    execFile(
      exec,
      execArgs,
      {
        windowsHide: true,
        timeout,
        maxBuffer: 4_000_000,
        cwd: homedir(),
        env: sanitizeEnv({
          ...process.env,
          npm_config_update_notifier: 'false',
          npm_config_fund: 'false'
        })
      },
      (err, stdout, stderr) => {
        const text = `${stdout || ''}\n${stderr || ''}`.trim()
        resolve({ ok: !err, text })
      }
    )
  })
}

function installed(spec: EngineSpec): boolean {
  return Boolean(knownLaunch(spec.id as EngineId, []))
}

export class EngineSync {
  private running = false
  private done = new Set<EngineId>()
  private inflight = new Map<EngineId, Promise<void>>()
  last: SyncEvent = { running: false, line: '', done: 0, total: 0 }

  constructor(private getWin: () => BrowserWindow | null) {}

  private emit(partial: Partial<SyncEvent>): void {
    this.last = { ...this.last, ...partial }
    this.getWin()?.webContents.send('sync:event', this.last)
  }

  async ensure(id: EngineId): Promise<void> {
    if (id === 'shell') return
    if (this.done.has(id)) return
    const existing = this.inflight.get(id)
    if (existing) return existing
    const spec = specById(id)
    const job = this.syncOne(spec)
      .catch((err) => {
        this.emit({
          line: `pq · ${id} fail: ${err instanceof Error ? err.message : String(err)}`
        })
      })
      .finally(() => {
        this.done.add(id)
        this.inflight.delete(id)
      })
    this.inflight.set(id, job)
    return job
  }

  async start(priority: EngineId[] = []): Promise<void> {
    if (this.running) return
    this.running = true
    const jobs = ENGINE_SPECS.map((s) => s.id).filter((id) => id !== 'shell')
    const order = [...new Set([...priority.filter((id) => id !== 'shell'), ...jobs])]
    this.emit({ running: true, done: 0, total: order.length, line: 'pq · sync engines…' })

    let done = 0
    for (const id of order) {
      this.emit({
        current: id,
        line: `pq · ${id} · update`,
        done,
        total: order.length
      })
      await this.ensure(id)
      done += 1
      this.emit({ done, total: order.length })
    }

    this.running = false
    this.emit({
      running: false,
      current: undefined,
      line: `pq · sync done ${done}/${order.length}`,
      done,
      total: order.length
    })
  }

  private async syncOne(spec: EngineSpec): Promise<void> {
    const have = installed(spec)

    if (!have && spec.npmPackage) {
      const r = await run(npmCmd(), ['install', '-g', spec.npmPackage], 240000)
      this.emit({
        line: `pq · ${spec.id} npm ${r.ok ? 'ok' : 'warn'}${r.text ? ' · ' + lastLine(r.text) : ''}`
      })
    }

    if (spec.selfUpdate) {
      const launch =
        knownLaunch(spec.id as EngineId, spec.selfUpdate) ??
        resolveLaunch(spec.id as EngineId, spec.binaries[0], spec.selfUpdate)
      if (!launch?.spawnFile) {
        this.emit({ line: `pq · ${spec.id} missing — skip self-update` })
      } else {
        const r = await run(launch.spawnFile, launch.args, 300000)
        this.emit({
          line: `pq · ${spec.id} ${spec.selfUpdate[0]} ${r.ok ? 'ok' : 'warn'}${
            r.text ? ' · ' + lastLine(r.text) : ''
          }`
        })
      }
      return
    }

    if (spec.npmPackage) {
      const r = await run(npmCmd(), ['install', '-g', `${spec.npmPackage}@latest`], 240000)
      this.emit({
        line: `pq · ${spec.id} npm ${r.ok ? 'ok' : 'warn'}${r.text ? ' · ' + lastLine(r.text) : ''}`
      })
    }
    if (spec.pipPackage) {
      const r = await run('python', ['-m', 'pip', 'install', '-U', spec.pipPackage], 240000)
      this.emit({
        line: `pq · ${spec.id} pip ${r.ok ? 'ok' : 'warn'}${r.text ? ' · ' + lastLine(r.text) : ''}`
      })
    }
  }
}
