import { execFile } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { BrowserWindow } from './host'
import type { EngineId, SyncEvent } from '../shared/types'
import { ENGINE_SPECS, type EngineSpec } from './engines'
import { knownLaunch } from './resolve-launch'

function npmCmd(): string {
  return join(homedir(), 'AppData', 'Roaming', 'npm', 'npm.cmd')
}

function run(file: string, args: string[], timeout = 180000): Promise<{ ok: boolean }> {
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
        maxBuffer: 2_000_000,
        env: {
          ...process.env,
          npm_config_update_notifier: 'false',
          npm_config_fund: 'false'
        }
      },
      (err) => resolve({ ok: !err })
    )
  })
}

function q(s: string): string {
  if (/[\s"]/.test(s)) return `"${s.replace(/"/g, '\\"')}"`
  return s
}

export class EngineSync {
  private running = false
  last: SyncEvent = { running: false, line: '', done: 0, total: 0 }

  constructor(private getWin: () => BrowserWindow | null) {}

  private emit(partial: Partial<SyncEvent>): void {
    this.last = { ...this.last, ...partial }
    this.getWin()?.webContents.send('sync:event', this.last)
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    const jobs = ENGINE_SPECS.filter((s) => s.id !== 'shell')
    this.emit({ running: true, done: 0, total: jobs.length, line: 'pq · sync engines…' })

    let done = 0
    for (const spec of jobs) {
      this.emit({
        current: spec.id,
        line: `pq · ${spec.id} · ${spec.npmPackage || spec.pipPackage || spec.selfUpdate?.join(' ') || 'check'}`,
        done,
        total: jobs.length
      })
      try {
        await this.syncOne(spec)
      } catch (err) {
        this.emit({
          line: `pq · ${spec.id} fail: ${err instanceof Error ? err.message : String(err)}`
        })
      }
      done += 1
      this.emit({ done, total: jobs.length })
    }

    this.running = false
    this.emit({
      running: false,
      current: undefined,
      line: `pq · sync done ${done}/${jobs.length}`,
      done,
      total: jobs.length
    })
  }

  private async syncOne(spec: EngineSpec): Promise<void> {
    if (spec.npmPackage) {
      const r = await run(npmCmd(), ['install', '-g', `${spec.npmPackage}@latest`])
      this.emit({ line: `pq · ${spec.id} npm ${r.ok ? 'ok' : 'warn'}` })
    }
    if (spec.pipPackage) {
      const r = await run('python', ['-m', 'pip', 'install', '-U', spec.pipPackage])
      this.emit({ line: `pq · ${spec.id} pip ${r.ok ? 'ok' : 'warn'}` })
    }
    if (spec.selfUpdate) {
      const launch = knownLaunch(spec.id as EngineId, spec.selfUpdate)
      if (!launch) {
        this.emit({ line: `pq · ${spec.id} missing — skip self-update` })
        return
      }
      const r = await run(launch.spawnFile, launch.args, 180000)
      this.emit({ line: `pq · ${spec.id} ${spec.selfUpdate[0]} ${r.ok ? 'ok' : 'warn'}` })
    }
  }
}
