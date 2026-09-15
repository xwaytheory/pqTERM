import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { EngineId, EngineUsage, UsageMap, UsageWindow } from '../shared/types'

function home(...parts: string[]): string {
  return join(homedir(), ...parts)
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function isoMs(v: unknown): number | undefined {
  const s = str(v)
  if (!s) return undefined
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : undefined
}

async function httpJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 15000
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers, signal: ac.signal })
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { ok: res.ok, status: res.status, json }
  } catch {
    return { ok: false, status: 0, json: null }
  } finally {
    clearTimeout(t)
  }
}

async function grokUsage(): Promise<EngineUsage | null> {
  const auth = asRecord(readJson(home('.grok', 'auth.json')))
  if (!auth) return null
  const first = Object.values(auth)[0]
  const entry = asRecord(first)
  if (!entry) return null
  let token = str(entry.key)
  const userId = str(entry.user_id) ?? ''
  const refresh = str(entry.refresh_token)
  const clientId = str(entry.oidc_client_id)
  const issuer = str(entry.oidc_issuer) ?? 'https://auth.x.ai'
  const verRaw = asRecord(readJson(home('.grok', 'version.json')))
  const version = str(verRaw?.version) ?? '1.0.0'

  const headers = (bearer: string): Record<string, string> => ({
    Authorization: `Bearer ${bearer}`,
    Accept: 'application/json',
    'X-XAI-Token-Auth': 'xai-grok-cli',
    'x-userid': userId,
    'x-grok-client-version': version,
    'x-grok-client-mode': 'headless'
  })

  const pull = async (bearer: string) =>
    httpJson('https://cli-chat-proxy.grok.com/v1/billing?format=credits', headers(bearer))

  if (!token) return null
  let res = await pull(token)
  if ((!res.ok || res.status === 401) && refresh && clientId) {
    const disc = await httpJson(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, {
      Accept: 'application/json'
    })
    const tokenEp = str(asRecord(disc.json)?.token_endpoint)
    if (tokenEp) {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: clientId
      })
      const refreshed = await fetch(tokenEp, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      })
        .then((r) => r.json() as Promise<Record<string, unknown>>)
        .catch(() => null)
      const next = str(refreshed?.access_token)
      if (next) {
        token = next
        res = await pull(next)
      }
    }
  }
  if (!res.ok) return { engine: 'grok', windows: [], note: 'usage offline', fetchedAt: Date.now() }
  const root = asRecord(res.json)
  const config = asRecord(root?.config) ?? root
  if (!config) return null
  const used = num(config.creditUsagePercent)
  const period = asRecord(config.currentPeriod)
  const resetAt = isoMs(period?.end) ?? isoMs(config.billingPeriodEnd)
  const plan = str(root?.subscriptionTier) ?? str(config.subscription_tier_display)
  if (used == null) return null
  return {
    engine: 'grok',
    plan: plan ?? undefined,
    windows: [{ id: 'weekly', label: '7d', usedPct: used, resetAt }],
    fetchedAt: Date.now()
  }
}

async function claudeUsage(): Promise<EngineUsage | null> {
  const credFile = home('.claude', '.credentials.json')
  const raw = asRecord(readJson(credFile))
  const oauth = asRecord(raw?.claudeAiOauth) ?? raw
  const token = str(oauth?.accessToken) ?? str(oauth?.access_token)
  if (!token) return null
  const res = await httpJson('https://api.anthropic.com/api/oauth/usage', {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'anthropic-beta': 'oauth-2025-04-20'
  })
  if (!res.ok) return null
  const j = asRecord(res.json)
  if (!j) return null
  const windows: UsageWindow[] = []
  const five = asRecord(j.five_hour) ?? asRecord(j.fiveHour)
  const week = asRecord(j.seven_day) ?? asRecord(j.sevenDay)
  const fivePct = num(five?.utilization) ?? num(five?.used_percent)
  const weekPct = num(week?.utilization) ?? num(week?.used_percent)
  if (fivePct != null) {
    windows.push({
      id: '5h',
      label: '5h',
      usedPct: fivePct <= 1 ? fivePct * 100 : fivePct,
      resetAt: isoMs(five?.resets_at) ?? (num(five?.resets_at) ? Number(five?.resets_at) * 1000 : undefined)
    })
  }
  if (weekPct != null) {
    windows.push({
      id: '7d',
      label: '7d',
      usedPct: weekPct <= 1 ? weekPct * 100 : weekPct,
      resetAt: isoMs(week?.resets_at) ?? (num(week?.resets_at) ? Number(week?.resets_at) * 1000 : undefined)
    })
  }
  if (!windows.length) return null
  return { engine: 'claude', windows, fetchedAt: Date.now() }
}

async function codexUsage(): Promise<EngineUsage | null> {
  const auth = asRecord(readJson(home('.codex', 'auth.json')))
  const tokens = asRecord(auth?.tokens)
  const access = str(tokens?.access_token)
  const account = str(tokens?.account_id)
  if (!access) return null
  const headers: Record<string, string> = {
    Authorization: `Bearer ${access}`,
    Accept: 'application/json'
  }
  if (account) headers['ChatGPT-Account-Id'] = account
  const res = await httpJson('https://chatgpt.com/backend-api/wham/usage', headers)
  if (!res.ok) return { engine: 'codex', windows: [], note: 'usage offline', fetchedAt: Date.now() }
  const j = asRecord(res.json)
  if (!j) return null
  const windows: UsageWindow[] = []
  const plan = asRecord(j.plan_info) ?? asRecord(j.rate_limit)
  const five = asRecord(j['5h']) ?? asRecord(j.five_hour) ?? asRecord(plan?.primary_window)
  const week = asRecord(j.weekly) ?? asRecord(j.seven_day) ?? asRecord(j.secondary_window)
  const pick = (obj: Record<string, unknown> | null, id: string, label: string) => {
    if (!obj) return
    const used =
      num(obj.used_percent) ??
      num(obj.usedPercent) ??
      num(obj.percent_used) ??
      num(asRecord(obj.limit)?.used_percent)
    if (used == null) return
    windows.push({
      id,
      label,
      usedPct: used,
      resetAt: isoMs(obj.reset_at ?? obj.resetAt ?? obj.resets_at)
    })
  }
  pick(five, '5h', '5h')
  pick(week, '7d', '7d')
  if (!windows.length) return null
  return { engine: 'codex', windows, fetchedAt: Date.now() }
}

function run(file: string, args: string[], timeout = 25000): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 2_000_000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''))
    })
  })
}

async function ompUsage(): Promise<EngineUsage | null> {
  const npm = home('AppData', 'Roaming', 'npm')
  const bun = join(npm, 'bun.exe')
  const cli = join(npm, 'node_modules', '@oh-my-pi', 'pi-coding-agent', 'dist', 'cli.js')
  if (!existsSync(bun) || !existsSync(cli)) return null
  const out = await run(bun, [cli, 'usage', '--json'])
  if (!out.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(out)
  } catch {
    return null
  }
  const root = asRecord(parsed)
  const reports = Array.isArray(root?.reports) ? root!.reports : []
  const windows: UsageWindow[] = []
  let plan: string | undefined
  for (const rep of reports) {
    const r = asRecord(rep)
    const accounts = Array.isArray(r?.accounts) ? r!.accounts : r ? [r] : []
    for (const acc of accounts) {
      const a = asRecord(acc)
      const limits = Array.isArray(a?.limits) ? a!.limits : Array.isArray(r?.limits) ? r!.limits : []
      for (const lim of limits) {
        const L = asRecord(lim)
        if (!L) continue
        const used =
          num(L.usedPercent) ??
          num(L.used_percent) ??
          (num(L.remainingPercent) != null ? 100 - Number(L.remainingPercent) : null)
        if (used == null) continue
        const label = str(L.window) ?? str(L.label) ?? 'plan'
        windows.push({
          id: `${str(r?.provider) ?? 'omp'}-${label}`,
          label: /7|week/i.test(label) ? '7d' : /5|hour|session/i.test(label) ? '5h' : label.slice(0, 6),
          usedPct: used,
          resetAt: isoMs(L.resetsAt ?? L.resets_at ?? L.resetAt)
        })
      }
    }
    plan = plan ?? str(r?.provider) ?? undefined
  }
  if (!windows.length) return null
  return { engine: 'omp', plan, windows: windows.slice(0, 3), fetchedAt: Date.now() }
}

export class UsageHub {
  private last: UsageMap = {}
  private timer: ReturnType<typeof setInterval> | null = null
  private listener: ((m: UsageMap) => void) | null = null
  private running = false

  onChange(fn: (m: UsageMap) => void): void {
    this.listener = fn
  }

  snapshot(): UsageMap {
    return this.last
  }

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), 60_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const rows = await Promise.allSettled([grokUsage(), claudeUsage(), codexUsage(), ompUsage()])
      const next: UsageMap = {}
      for (const row of rows) {
        if (row.status !== 'fulfilled' || !row.value) continue
        next[row.value.engine] = row.value
      }
      this.last = next
      this.listener?.(next)
    } finally {
      this.running = false
    }
  }
}
