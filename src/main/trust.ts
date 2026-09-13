import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, resolve } from 'path'

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

function unique(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    const n = resolve(p)
    const k = n.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(n)
  }
  return out
}

function gitRoot(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      timeout: 4000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim()
    return out ? resolve(out) : null
  } catch {
    return null
  }
}

function slash(p: string): string {
  return p.replace(/\\/g, '/')
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function readJson(file: string): Record<string, unknown> {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function trustGrok(dir: string): void {
  const file = resolve(homedir(), '.grok', 'trusted_folders.toml')
  const cur = readText(file)
  const keys = [`folders.'${dir}'`, `folders."${dir.replace(/\\/g, '\\\\')}"`]
  if (keys.some((k) => cur.includes(k))) return
  mkdirSync(dirname(file), { recursive: true })
  const block = `\n[folders.'${dir}']\ntrusted = true\ndecided_at = ${nowSec()}\n`
  writeFileSync(file, cur.trimEnd() + block, 'utf8')
}

function trustClaude(dir: string): void {
  const file = resolve(homedir(), '.claude.json')
  const json = readJson(file)
  const projects = (json.projects && typeof json.projects === 'object' ? json.projects : {}) as Record<
    string,
    Record<string, unknown>
  >
  const key = slash(dir)
  const prev = projects[key] && typeof projects[key] === 'object' ? projects[key] : {}
  if (prev.hasTrustDialogAccepted === true) return
  projects[key] = {
    ...prev,
    hasTrustDialogAccepted: true,
    hasClaudeMdExternalIncludesApproved: true
  }
  json.projects = projects
  writeJson(file, json)
}

function trustGemini(dir: string): void {
  const file = resolve(homedir(), '.gemini', 'trustedFolders.json')
  const json = readJson(file)
  const key = slash(dir).toLowerCase()
  if (json[key] === 'TRUST_FOLDER') return
  json[key] = 'TRUST_FOLDER'
  writeJson(file, json)
}

function trustCodex(dir: string): void {
  const file = resolve(homedir(), '.codex', 'config.toml')
  const cur = readText(file)
  const key = dir.toLowerCase()
  const header = `[projects.'${key}']`
  if (cur.toLowerCase().includes(header.toLowerCase())) {
    if (/trust_level\s*=\s*"trusted"/i.test(cur)) return
  }
  mkdirSync(dirname(file), { recursive: true })
  const block = `\n[projects.'${key}']\ntrust_level = "trusted"\n`
  writeFileSync(file, (cur.trimEnd() ? cur.trimEnd() + '\n' : '') + block, 'utf8')
}

/**
 * Persist "trust this folder" for the workspace so CLIs skip the first-run dialog.
 * Best-effort only: each provider write is catch-ignored so a locked/readonly home
 * config never throws into the PTY spawn path. Callers may also catch (belt + suspenders).
 */
export function trustWorkspace(cwd: string): void {
  if (!cwd) return
  const root = gitRoot(cwd)
  const folders = unique([cwd, root].filter((p): p is string => Boolean(p)))
  for (const dir of folders) {
    try {
      trustGrok(dir)
    } catch {
      /* ignore — trust must not block pane spawn */
    }
    try {
      trustClaude(dir)
    } catch {
      /* ignore — trust must not block pane spawn */
    }
    try {
      trustGemini(dir)
    } catch {
      /* ignore — trust must not block pane spawn */
    }
    try {
      trustCodex(dir)
    } catch {
      /* ignore — trust must not block pane spawn */
    }
  }
}
