import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { EngineId } from '../shared/types'

function q(s: string): string {
  if (/[\s"]/.test(s)) return `"${s.replace(/"/g, '\\"')}"`
  return s
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (p && existsSync(p)) return p
  }
  return null
}

function npmDir(): string {
  return join(homedir(), 'AppData', 'Roaming', 'npm')
}

export function knownLaunch(engine: EngineId, extra: string[]): { spawnFile: string; args: string[] } | null {
  const npm = npmDir()
  switch (engine) {
    case 'grok': {
      const exe = firstExisting([join(homedir(), '.grok', 'bin', 'grok.exe')])
      return exe ? { spawnFile: exe, args: extra } : null
    }
    case 'opencode': {
      const exe = firstExisting([
        join(npm, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
        join(npm, 'node_modules', 'opencode-windows-x64', 'bin', 'opencode.exe')
      ])
      return exe ? { spawnFile: exe, args: extra } : null
    }
    case 'claude': {
      const exe = firstExisting([
        join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
      ])
      return exe ? { spawnFile: exe, args: extra } : null
    }
    case 'codex': {
      const exe = firstExisting([
        join(
          npm,
          'node_modules',
          '@openai',
          'codex',
          'node_modules',
          '@openai',
          'codex-win32-x64',
          'vendor',
          'x86_64-pc-windows-msvc',
          'bin',
          'codex.exe'
        )
      ])
      return exe ? { spawnFile: exe, args: extra } : null
    }
    case 'hermes': {
      const exe = firstExisting([
        join(homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
        join(homedir(), 'AppData', 'Local', 'hermes', 'bin', 'hermes.exe')
      ])
      return exe ? { spawnFile: exe, args: extra } : null
    }
    case 'omp': {
      const script = firstExisting([
        join(npm, 'node_modules', '@oh-my-pi', 'pi-coding-agent', 'dist', 'cli.js')
      ])
      const bun = firstExisting([join(npm, 'bun.exe')])
      if (bun && script) return { spawnFile: bun, args: [script, ...extra] }
      return null
    }
    case 'qwen':
    case 'dsh':
    case 'gemini':
    case 'crush':
    case 'copilot': {
      const name = engine
      const exe = firstExisting([
        join(npm, `${name}.cmd`),
        join(npm, `${name}.exe`),
        join(npm, 'node_modules', '.bin', `${name}.cmd`)
      ])
      return exe ? { spawnFile: exe, args: extra } : null
    }
    case 'aider': {
      const exe = firstExisting([
        join(homedir(), 'AppData', 'Roaming', 'Python', 'Python314', 'Scripts', 'aider.exe'),
        join(homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python314', 'Scripts', 'aider.exe'),
        join(npm, 'aider.cmd')
      ])
      return exe ? { spawnFile: exe, args: extra } : null
    }
    default:
      return null
  }
}

export function yoloEnv(engine: EngineId): Record<string, string> {
  switch (engine) {
    case 'opencode':
      return {
        OPENCODE_YOLO: 'true',
        OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS: '1'
      }
    case 'hermes':
      return { HERMES_YOLO_MODE: '1' }
    default:
      return {}
  }
}

/** Turn npm/hermes shims into a real exe + argv so ConPTY attaches to the TUI. */
export function resolveLaunch(
  engine: EngineId,
  target: string,
  extra: string[]
): { spawnFile: string; args: string[] } {
  if (engine === 'shell') {
    return { spawnFile: 'powershell.exe', args: ['-NoLogo', '-NoExit'] }
  }

  const known = knownLaunch(engine, extra)
  if (known) return known

  const lower = (target || '').toLowerCase()
  if (lower.endsWith('.exe') && existsSync(target)) {
    return { spawnFile: target, args: extra }
  }

  if (target && !lower.endsWith('.cmd') && !lower.endsWith('.bat')) {
    const asCmd = target.endsWith('.cmd') ? target : `${target}.cmd`
    const absCmd = existsSync(asCmd)
      ? asCmd
      : firstExisting([join(npmDir(), `${engine}.cmd`), join(npmDir(), `${target}.cmd`)])
    if (absCmd) return resolveLaunch(engine, absCmd, extra)
    const asExe = firstExisting([`${target}.exe`, join(npmDir(), `${engine}.exe`)])
    if (asExe) return { spawnFile: asExe, args: extra }
  }

  if (target && (lower.endsWith('.cmd') || lower.endsWith('.bat')) && existsSync(target)) {
    const dir = dirname(target)
    const text = readFileSync(target, 'utf8')
    const dp0Exes = [...text.matchAll(/"%dp0%\\([^"\r\n]+?\.exe)"/gi)].map((m) =>
      join(dir, m[1].replace(/\//g, '\\'))
    )
    const native = firstExisting(dp0Exes.filter((p) => !/\\(bun|node)\.exe$/i.test(p)))
    if (native) return { spawnFile: native, args: extra }
  }

  return {
    spawnFile: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/k', [q(target || engine), ...extra.map(q)].join(' ')]
  }
}

export function sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env }
  for (const key of Object.keys(out)) {
    if (
      key.startsWith('ELECTRON_') ||
      key === 'CHROME_CRASHPAD_PIPE_NAME' ||
      key === 'ORIGINAL_XDG_CURRENT_DESKTOP'
    ) {
      delete out[key]
    }
  }
  return out
}
