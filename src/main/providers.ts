import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ProviderInfo } from '../shared/types'
import { isRawShell } from '../shared/types'
import { defaultProvider, ENGINE_SPECS, type EngineSpec } from './engines'
import { knownLaunch } from './resolve-launch'
import { cliCapabilities, managedCommand } from './engine-manager'

function expand(p: string): string {
  return p
    .replace(/%USERPROFILE%/gi, homedir())
    .replace(/%APPDATA%/gi, process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'))
}

function which(bin: string, extraDirs: string[]): string | null {
  const dirs = [
    ...extraDirs.map(expand),
    ...(process.env.PATH ?? process.env.Path ?? '').split(';')
  ]
  const exts = /\.(exe|cmd|bat)$/i.test(bin) ? [''] : ['.exe', '.cmd', '.bat']
  for (const dir of dirs) {
    if (!dir) continue
    for (const ext of exts) {
      const full = join(dir, bin + ext)
      if (existsSync(full)) {
        try {
          if (statSync(full).isFile()) return full
        } catch {
          /* ignore */
        }
      }
    }
  }
  return null
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function emailsIn(text: string): string[] {
  const found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  return [...new Set(found.map((e) => e.toLowerCase()))]
}

function walkFiles(root: string, max = 40): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length && out.length < max) {
    const dir = stack.pop()
    if (!dir || !existsSync(dir)) continue
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git' || name === 'Cache' || name === 'logs') continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(full)
      else if (/\.(json|jsonl|yml|yaml|toml|cfg|ini|txt)$/i.test(name) || name.startsWith('.')) {
        out.push(full)
      }
    }
  }
  return out
}

interface Probe {
  installedPath: string | null
  authFiles: string[]
  emails: string[]
  authed: boolean
}

function probeGrok(): Probe {
  const home = join(homedir(), '.grok')
  const files = [
    join(home, 'auth.json'),
    join(home, 'config.toml'),
    join(home, 'models_cache.json')
  ].filter((f) => existsSync(f))
  const emails = files.flatMap((f) => emailsIn(readText(f)))
  const authed = existsSync(join(home, 'auth.json')) && /refresh_token|auth_mode|oidc/i.test(readText(join(home, 'auth.json')))
  return { installedPath: null, authFiles: files, emails, authed }
}

function probeClaude(): Probe {
  const files = [
    join(homedir(), '.claude.json'),
    join(homedir(), '.claude', 'settings.json'),
    join(homedir(), '.config', 'claude', 'config.json'),
    join(homedir(), 'AppData', 'Roaming', 'claude', 'config.json')
  ].filter((f) => existsSync(f))
  const dir = join(homedir(), '.claude')
  const all = [...new Set([...files, ...(existsSync(dir) ? walkFiles(dir, 25) : [])])]
  const emails = all.flatMap((f) => emailsIn(readText(f)))
  const authed = all.some((f) => {
    const t = readText(f).toLowerCase()
    return t.includes('oauth') || t.includes('token') || t.includes('session') || t.includes('@')
  })
  return { installedPath: null, authFiles: all, emails, authed }
}

function probeOpenCode(): Probe {
  const files = [
    join(homedir(), '.local', 'share', 'opencode', 'auth.json'),
    join(homedir(), '.config', 'opencode', 'opencode.jsonc'),
    join(homedir(), '.config', 'opencode', 'cli.json'),
    join(homedir(), '.local', 'state', 'opencode', 'model.json')
  ].filter((f) => existsSync(f))
  const emails = files.flatMap((f) => emailsIn(readText(f)))
  const authFile = join(homedir(), '.local', 'share', 'opencode', 'auth.json')
  const authed = existsSync(authFile) || files.length > 0
  return { installedPath: null, authFiles: files, emails, authed }
}

function probeHermes(): Probe {
  const local = join(homedir(), 'AppData', 'Local', 'hermes')
  const files = [
    join(local, 'auth.json'),
    join(local, 'auth', 'google_oauth.json'),
    join(local, 'config.yaml')
  ].filter((f) => existsSync(f))
  if (existsSync(local)) files.push(...walkFiles(join(local, 'auth'), 10))
  const emails = files.flatMap((f) => emailsIn(readText(f)))
  const auth = existsSync(join(local, 'auth.json')) ? readText(join(local, 'auth.json')) : ''
  const authed = /access_token|refresh_token|credential_pool/i.test(auth) || emails.length > 0
  return { installedPath: null, authFiles: files, emails, authed }
}

function probeCodex(): Probe {
  const files = [
    join(homedir(), '.codex', 'auth.json'),
    join(homedir(), '.codex', 'config.toml'),
    join(homedir(), '.codex', 'models_cache.json')
  ].filter((f) => existsSync(f))
  const emails = files.flatMap((f) => emailsIn(readText(f)))
  const auth = existsSync(join(homedir(), '.codex', 'auth.json'))
    ? readText(join(homedir(), '.codex', 'auth.json'))
    : ''
  const authed = /chatgpt|refresh_token|auth_mode/i.test(auth)
  return { installedPath: null, authFiles: files, emails, authed }
}

function probeOmp(): Probe {
  const root = join(homedir(), '.omp', 'agent')
  const files = [
    join(root, 'config.yml'),
    join(root, 'models.yml'),
    join(root, 'agent.db'),
    join(root, 'models.db')
  ].filter((f) => existsSync(f))
  const emails = files.filter((f) => !f.endsWith('.db')).flatMap((f) => emailsIn(readText(f)))
  const modelsYml = existsSync(join(root, 'models.yml')) ? readText(join(root, 'models.yml')) : ''
  const authed =
    existsSync(join(root, 'agent.db')) || /apiKey|api_key|auth:/i.test(modelsYml) || emails.length > 0
  return { installedPath: null, authFiles: files, emails, authed }
}

function probeFor(spec: EngineSpec): Probe {
  switch (spec.id) {
    case 'grok':
      return probeGrok()
    case 'claude':
      return probeClaude()
    case 'opencode':
      return probeOpenCode()
    case 'hermes':
      return probeHermes()
    case 'codex':
      return probeCodex()
    case 'omp':
      return probeOmp()
    default:
      return { installedPath: null, authFiles: [], emails: [], authed: true }
  }
}

export function scanProviders(userEmail?: string, previous?: ProviderInfo[]): ProviderInfo[] {
  const prev = new Map((previous ?? []).map((p) => [p.id, p]))
  const email = userEmail?.toLowerCase()

  return ENGINE_SPECS.map((spec) => {
    const resolved =
      managedCommand(spec.id) ??
      spec.binaries.map((b) => which(b, spec.extraPathDirs)).find((x): x is string => Boolean(x)) ??
      knownLaunch(spec.id, [])?.spawnFile ??
      null
    const probe = probeFor(spec)
    const installed = Boolean(resolved) || isRawShell(spec.id)
    const matched = email
      ? probe.emails.find((e) => e === email)
      : probe.emails[0]
    const detectedAuth = isRawShell(spec.id) ? true : probe.authed || Boolean(matched)
    const old = prev.get(spec.id)
    const base = defaultProvider(spec, {
      installed,
      cli: cliCapabilities(spec),
      detectedAuth,
      matchedEmail: matched,
      resolvedPath: resolved ?? undefined,
      command: resolved ?? spec.binaries[0],
      enabled: old ? old.enabled : installed && (detectedAuth || isRawShell(spec.id))
    })
    if (old) {
      base.enabled = old.enabled
      base.models = spec.models.map((m) => {
        const om = old.models.find((x) => x.id === m.id)
        return { ...m, enabled: om ? om.enabled : true }
      })
    }
    // First-time: auto-enable if installed AND (auth detected OR email matched)
    if (!old) {
      base.enabled = installed && (detectedAuth || isRawShell(spec.id))
    }
    return base
  })
}

export function applyEmailMatch(providers: ProviderInfo[], userEmail?: string): ProviderInfo[] {
  if (!userEmail) return providers
  const email = userEmail.toLowerCase()
  return providers.map((p) => {
    if (isRawShell(p.id)) return p
    const match = p.matchedEmail === email
    if (match && p.installed) {
      return { ...p, enabled: true, detectedAuth: true }
    }
    return p
  })
}

export { readJson }
