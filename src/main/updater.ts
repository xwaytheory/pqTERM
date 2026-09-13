import { execFile, spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { UpdateJob, UpdatePhase, UpdateStatus, UpdateSteps } from '../../shared/types'
import { compareVersions } from '../../shared/types'

/**
 * PQUpdater — aktualizacje z kanału git.
 *
 * pq dystrybuowane jest jako git-clone (`host/pq.exe <root>`), więc
 * "aktualizacja" = pobranie zmian z origin/GitHub i odbudowa artefaktów:
 *
 *   git fetch → stash lokalnych zmian → reset --hard origin/<channel>
 *   → npm install (jeśli deps się zmieniły) + stamp/rebuild → build (jeśli src)
 *   → stash pop → relaunch.
 *
 * Samo wykonanie robi detached `scripts/updater.cjs` (zapisuje UpdateJob do
 * <userData>/pq-update-pending.json), które przetrwa wyjście aplikacji.
 * W trybie dev aktualizacje są domyślnie wyłączone (PQ_UPDATE_ALLOW_DEV=1
 * włącza sprawdzanie + zlecanie).
 */

export interface UpdateOpts {
  root: string
  userData: string
  scriptPath: string
  /** aktualna wersja (app.getVersion w prod / FsAsync w dev) */
  currentVersion: () => string
  /** status → IPC do renderera */
  notify: (status: UpdateStatus) => void
  /** wywołane, gdy app ma za chwilę wyjść (po zleceniu joba) */
  onApply?: () => void
  isDev?: boolean
  channel?: string
  allowedRepo?: string
}

const CFG_FILE = 'pq-update.json'
const JOB_FILE = 'pq-update-pending.json'
const LOG_FILE = 'pq-update.log'
const INTERVAL_MS = 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 4 * 1000
const APPLIED_WINDOW_MS = 90 * 1000
const FETCH_TIMEOUT_MS = 35 * 1000
const GIT_TIMEOUT_MS = 25 * 1000

interface RunResult {
  ok: boolean
  out: string
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function repoId(url: string): string | null {
  const m = String(url || '')
    .replace(/^git@github\.com:/, '')
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .match(/^([^/]+)\/([^/]+)$/)
  return m ? `${m[1]}/${m[2]}` : null
}

function friendlyGitError(out: string): string {
  const s = String(out || '').toLowerCase()
  if (/could not resolve host|temporary failure/i.test(s)) return 'brak sieci (nie można dojść do GitHub)'
  if (/403|403 forbidden|could not read username|terminal prompts disabled/i.test(s)) return 'brak uprawnień git — zaloguj się (gh auth login)'
  return String(out || 'git error').trim().split('\n')[0]
}

function exeArgsFrom(root: string): string[] {
  const args = process.argv.slice(1)
  return args.length ? args : [root]
}

function isPqBinary(root: string): string | null {
  const hostExe = join(root, 'host', 'pq.exe')
  return existsSync(hostExe) ? hostExe : null
}

function runCmd(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return resolve({ ok: false, out: String(stderr || stdout || '') })
        resolve({ ok: true, out: String(stdout || '') })
      }
    )
  })
}

export class PQUpdater {
  private readonly root: string
  private readonly userData: string
  private readonly scriptPath: string
  private readonly allowedRepo: string
  private readonly isDev: boolean
  private readonly getVersion: () => string
  private readonly notify: (s: UpdateStatus) => void
  private readonly onApply?: () => void

  private readonly cfgPath: string
  private readonly jobPath: string
  private readonly logPath: string

  private phase: UpdatePhase = 'disabled'
  private message = ''
  private error?: string
  private currentVersion = ''
  private currentCommit = ''
  private nextVersion?: string
  private nextCommit?: string
  private commitsBehind = 0
  private steps: UpdateSteps = { install: false, stamp: false, build: false }
  private applyOnQuit = false
  private ignoredVersion?: string
  private lastCheckAt?: number
  private lastAppliedAt?: number
  private lastAppliedVersion?: string

  private checking = false
  private applying = false
  private disposed = false

  private timer: ReturnType<typeof setTimeout> | null = null
  private interval: ReturnType<typeof setInterval> | null = null

  constructor(opts: UpdateOpts) {
    this.root = opts.root
    this.userData = opts.userData
    this.scriptPath = opts.scriptPath
    this.allowedRepo = (opts.allowedRepo || 'xwaytheory/pq').toLowerCase()
    this.isDev = opts.isDev ?? false
    this.getVersion = opts.currentVersion
    this.notify = opts.notify
    this.onApply = opts.onApply
    this.cfgPath = join(opts.userData, CFG_FILE)
    this.jobPath = join(opts.userData, JOB_FILE)
    this.logPath = join(opts.userData, LOG_FILE)
  }

  /** startuje serwis: ładuje zapisany stan, planuje pierwsze sprawdzenie + cykl. */
  init(): void {
    const cfg = this.readCfg()
    this.applyOnQuit = Boolean(cfg.applyOnQuit)
    this.ignoredVersion = typeof cfg.ignoredVersion === 'string' ? cfg.ignoredVersion : undefined
    this.lastCheckAt = typeof cfg.lastCheckAt === 'number' ? cfg.lastCheckAt : undefined
    this.lastAppliedAt = typeof cfg.lastAppliedAt === 'number' ? cfg.lastAppliedAt : undefined
    this.lastAppliedVersion =
      typeof cfg.lastAppliedVersion === 'string' ? cfg.lastAppliedVersion : undefined

    const job = this.readJob()
    if (job) {
      this.phase = isPidAlive(job.updaterPid ?? NaN) ? 'applying' : 'error'
      this.message = this.phase === 'applying' ? 'aktualizacja w toku…' : 'poprzednia aktualizacja nie dokończyła się'
      if (this.phase === 'error') this.error = 'proces updatera przerwany — sprawdź pq-update.log'
    } else if (cfg.lastAppliedAt && Date.now() - Number(cfg.lastAppliedAt) < APPLIED_WINDOW_MS) {
      this.phase = 'applied'
      this.message = `zaktualizowano do v${this.lastAppliedVersion || this.getVersion()}`
    } else {
      this.phase = 'disabled'
      this.message = 'pq — status aktualizacji'
    }

    if (this.enabled()) {
      this.interval = setInterval(() => {
        if (!this.disposed && !this.checking && !this.applying) void this.check()
      }, INTERVAL_MS)
      this.timer = setTimeout(() => {
        if (!this.disposed && !this.applying) void this.check()
      }, FIRST_CHECK_DELAY_MS)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.interval) clearInterval(this.interval)
    if (this.timer) clearTimeout(this.timer)
    this.interval = null
    this.timer = null
  }

  private enabled(): boolean {
    return !this.isDev || process.env.PQ_UPDATE_ALLOW_DEV === '1'
  }

  status(): UpdateStatus {
    void this.readCfg
    const snap: UpdateStatus = {
      phase: this.phase,
      channel: process.env.PQ_UPDATE_CHANNEL || 'main',
      currentVersion: this.currentVersion || this.getVersion(),
      currentCommit: this.currentCommit,
      commitsBehind: this.commitsBehind,
      message: this.message,
      steps: { ...this.steps },
      logPath: this.logPath
    }
    if (this.nextVersion) snap.nextVersion = this.nextVersion
    if (this.nextCommit) snap.nextCommit = this.nextCommit
    if (this.lastCheckAt) snap.lastCheckAt = this.lastCheckAt
    if (this.lastAppliedAt) snap.lastAppliedAt = this.lastAppliedAt
    if (this.lastAppliedVersion) snap.lastAppliedVersion = this.lastAppliedVersion
    if (this.ignoredVersion) snap.ignoredVersion = this.ignoredVersion
    if (this.error) snap.error = this.error
    return snap
  }

  private readCfg(): Record<string, unknown> {
    try {
      return JSON.parse(readFileSync(this.cfgPath, 'utf8')) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  private writeCfg(cfg: Record<string, unknown>): void {
    try {
      mkdirSync(this.userData, { recursive: true })
      writeFileSync(this.cfgPath, JSON.stringify(cfg, null, 2), 'utf8')
    } catch {
      /* ignore */
    }
  }

  private persistCfg(): void {
    this.writeCfg({
      applyOnQuit: this.applyOnQuit,
      ignoredVersion: this.ignoredVersion,
      lastCheckAt: this.lastCheckAt,
      lastAppliedAt: this.lastAppliedAt,
      lastAppliedVersion: this.lastAppliedVersion
    })
  }

  private readJob(): UpdateJob | null {
    try {
      return JSON.parse(readFileSync(this.jobPath, 'utf8')) as UpdateJob
    } catch {
      return null
    }
  }

  private writeJob(job: UpdateJob): void {
    try {
      mkdirSync(this.userData, { recursive: true })
      writeFileSync(this.jobPath, JSON.stringify(job, null, 2), 'utf8')
    } catch {
      /* ignore */
    }
  }

  private removeJob(): void {
    try {
      rmSync(this.jobPath, { force: true })
    } catch {
      /* ignore */
    }
  }

  private git(args: string[], timeout?: number): Promise<RunResult> {
    return runCmd('git', args, this.root, timeout || GIT_TIMEOUT_MS)
  }

  private async check(): Promise<void> {
    if (this.disposed || this.checking || this.applying) return
    if (!this.enabled()) {
      this.phase = 'disabled'
      this.message = 'aktualizacje wyłączone (dev)'
      this.notify(this.status())
      return
    }
    this.checking = true
    this.currentVersion = this.getVersion()
    this.phase = 'checking'
    this.message = 'sprawdzanie aktualizacji…'
    this.notify(this.status())

    const remote = await this.git(['remote', 'get-url', 'origin'])
    if (remote.ok && repoId(remote.out)?.toLowerCase() !== this.allowedRepo) {
      this.phase = 'disabled'
      this.message = `repo nieautoryzowane (${repoId(remote.out) || '?'})`
      this.error = `PQ_UPDATE_REPO=${this.allowedRepo}`
      this.checking = false
      this.persistCfg()
      this.notify(this.status())
      return
    }
    if (!remote.ok) {
      this.phase = 'disabled'
      this.message = 'aktualizacje wyłączone (brak origin)'
      this.checking = false
      this.notify(this.status())
      return
    }

    const fetch = await this.git(['fetch', '--quiet', '--prune', 'origin', this.channel()], FETCH_TIMEOUT_MS)
    if (!fetch.ok) {
      this.phase = 'error'
      this.message = 'nie udało się pobrać zmian (offline?)'
      this.error = friendlyGitError(fetch.out)
      this.checking = false
      this.notify(this.status())
      return
    }

    const head = await this.git(['rev-parse', 'HEAD'])
    const ref = await this.git(['rev-parse', '--verify', `origin/${this.channel()}`])
    if (!ref.ok) {
      this.phase = 'error'
      this.message = `kanał "${this.channel()}" nie istnieje zdalnie`
      this.error = friendlyGitError(ref.out)
      this.checking = false
      this.notify(this.status())
      return
    }
    this.nextCommit = ref.out.trim()
    if (head.ok && this.nextCommit === head.out.trim()) {
      this.commitsBehind = 0
      this.nextVersion = undefined
      this.phase = 'uptodate'
      this.message = 'pq jest na najnowszej wersji'
      this.lastCheckAt = Date.now()
      this.checking = false
      this.persistCfg()
      this.notify(this.status())
      return
    }

    const cnt = await this.git(['rev-list', '--count', `HEAD..origin/${this.channel()}`])
    this.commitsBehind = cnt.ok ? Number(cnt.out.trim()) || 1 : 1

    const pkg = await this.git(['show', `origin/${this.channel()}:package.json`])
    if (pkg.ok) {
      const m = pkg.out.match(/"version"\s*:\s*"([^"]+)"/)
      if (m) this.nextVersion = m[1]
    }
    this.phase = 'available'
    this.message = `nowa wersja pq v${this.nextVersion || '?'} — ${this.commitsBehind} ${this.commitsBehind === 1 ? 'commit' : 'commitów'} do pobrania`
    this.lastCheckAt = Date.now()
    this.checking = false
    this.persistCfg()
    this.notify(this.status())
  }

  private channel(): string {
    return process.env.PQ_UPDATE_CHANNEL || 'main'
  }

  /**
   * Co updater zrobi po pobraniu zmian (kroki maszynowe) — liczone z plików
   * zmienionych między HEAD a origin/<channel>.
   */
  async plan(): Promise<UpdateSteps> {
    const d = await this.git(['diff', '--name-only', `HEAD..origin/${this.channel()}`])
    const files = d.ok ? d.out.split(/\r?\n/).filter(Boolean) : []
    const install = files.some((f) => /(^|[/\\])(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/i.test(f))
    const stamp = files.some((f) => /(^|[/\\])(package\.json|package-lock\.json)$/i.test(f))
    const build = files.some((f) => /^(src[/\\]|scripts[/\\]|index\.html$|.*\.vite\.config\.ts$|.*tsconfig.*\.json$)/i.test(f))
    const steps: UpdateSteps = { install, stamp, build }
    this.steps = steps
    return steps
  }

  /** zleca detached updaterowi aktualizację i relokuje aplikację po zakończeniu. */
  async apply(): Promise<void> {
    if (!this.enabled() || this.applying || this.disposed) return
    if (this.phase !== 'available' && this.phase !== 'applied') {
      await this.check()
      this.applyOnQuit = true
      this.persistCfg()
      if (this.phase !== 'available') return
    }

    const jobPath = join(this.userData, JOB_FILE)
    const exe = isPqBinary(this.root) || process.execPath
    const args = exeArgsFrom(this.root)
    const job: UpdateJob = {
      id: randomUUID(),
      root: this.root,
      channel: this.channel(),
      targetCommit: this.nextCommit || '',
      targetVersion: this.nextVersion || this.currentVersion || '',
      exePath: exe,
      exeArgs: args,
      relaunch: true,
      steps: { ...this.steps },
      appPid: process.pid,
      ts: Date.now()
    }
    writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8')

    const child = spawn('node', [this.scriptPath, this.userData, job.id], {
      cwd: this.root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
    child.on('error', () => {
      this.phase = 'error'
      this.message = 'nie udało się uruchomić updatera'
    })
    this.applying = true
    this.phase = 'applying'
    this.message = 'aktualizacja w toku — wrócę za chwilę'
    this.persistCfg()
    this.notify(this.status())
    this.onApply?.()
  }

  /** przydzielenie wersji do zignorowania (PQ_UPDATE_IGNORE) — przestaje proponować. */
  ignore(version?: string): void {
    this.ignoredVersion = version || this.nextVersion || undefined
    this.phase = 'disabled'
    this.message = this.ignoredVersion ? `pominięto v${this.ignoredVersion}` : 'pq — status aktualizacji'
    this.persistCfg()
    this.notify(this.status())
  }

  setApplyOnQuit(on: boolean): void {
    this.applyOnQuit = on
    this.persistCfg()
    this.notify(this.status())
  }

  getApplyOnQuit(): boolean {
    return this.applyOnQuit
  }

  getIgnoredVersion(): string | undefined {
    return this.ignoredVersion
  }

  /** użytkownik widział komunikat "zaktualizowano" — nie pokazuj go więcej (bez resetu). */
  dismissApplied(): void {
    this.phase = 'disabled'
    this.message = 'pq — status aktualizacji'
    this.notify(this.status())
  }

  /** user odrzuca błąd updaterа — czyścimy marker i pozwalamy sprawdzić ponownie. */
  async dismissError(): Promise<void> {
    this.removeJob()
    this.phase = 'disabled'
    this.message = 'pq — sprawdź ponownie'
    this.error = undefined
    this.notify(this.status())
    await this.check()
  }

  /** Ostatnie 200 linii logu updatera (do "Pokaż log"). */
  readLogTail(lines = 200): string {
    try {
      const raw = readFileSync(this.logPath, 'utf8')
      return String(raw).replace(/\r\n/g, '\n').split('\n').slice(-lines).join('\n')
    } catch {
      return ''
    }
  }

  private friendlyError(out: string): string {
    return friendlyGitError(String(out || ''))
  }
}
