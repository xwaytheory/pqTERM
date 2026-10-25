import type { EngineAction, EngineId } from '../shared/types'

/**
 * One click on a CLI tile opens a visible cmd/PowerShell window running the
 * official install / update / uninstall command. pqTERM does not install,
 * track or uninstall anything itself — the user sees the whole run.
 *
 * The command is written to a temp .cmd/.ps1 file instead of being passed on
 * the shell's command line: paths (Program Files, %TEMP%) and quoted URLs then
 * survive without nested-quote bugs.
 *
 * Null = no safe scripted command; the UI hides that action instead of
 * guessing an installer/uninstaller that could damage a native install.
 */
type LifecycleSpec = {
  id: EngineId
  binaries: string[]
  npmPackage?: string
  pipPackage?: string
  selfUpdate?: string[]
  extraPathDirs?: string[]
}

export type LifecycleScript = { kind: 'cmd' | 'ps1'; body: string }

/**
 * Installers that are NOT a package manager. Everything with npmPackage /
 * pipPackage is generated below, so install and uninstall can never disagree
 * about the package name. All URLs verified 2026-10-25.
 */
const INSTALL: Partial<Record<EngineId, string>> = {
  // Official installer; npm needs --ignore-scripts for this one, so use theirs.
  pi: 'irm https://pi.dev/install.ps1 | iex',
  // qodercli installer pulls the binary, then runs `qodercli install --force`.
  qoder: 'irm https://qoder-ide.oss-accelerate.aliyuncs.com/qodercli/install.ps1 | iex',
  // Creates .venv in the CWD → RUN_IN pins it to ~/.baicode (see engines.ts).
  baicode:
    'iwr -useb https://raw.githubusercontent.com/BAI-labs/BAI-tools/main/scripts/baicode_install.ps1 | iex',
  // cursor.com/docs/cli/installation → Windows: irm 'https://cursor.com/install?win32=true' | iex
  cursor: "irm 'https://cursor.com/install?win32=true' | iex",
  // antigravity.google/cli/install.cmd (batch; installs %LOCALAPPDATA%\agy\bin\agy.exe)
  antigravity:
    'curl -fsSL https://antigravity.google/cli/install.cmd -o "%TEMP%\\agy-install.cmd" && call "%TEMP%\\agy-install.cmd"',
  // openrouter.ai/docs/guides/ori/overview → Windows PowerShell installer
  ori: 'irm https://openrouter.ai/labs/ori/install.ps1 | iex'
}

/** Official self-uninstall subcommands for native installs (verified via --help). */
const NATIVE_UNINSTALL: Partial<Record<EngineId, string>> = {
  hermes: 'hermes uninstall'
}

/** Native updaters for engines that ship no selfUpdate args in their spec. */
const NATIVE_UPDATE: Partial<Record<EngineId, string>> = {
  hermes: 'hermes update',
  // openrouter.ai/docs/guides/ori/overview → "ori update"
  ori: 'ori update'
}

/**
 * Installers that write relative to the CWD. Pinned so the binary lands where
 * detection looks for it (engines.ts extraPathDirs) instead of ~/.venv.
 */
const RUN_IN: Partial<Record<EngineId, string>> = {
  baicode: '%USERPROFILE%\\.baicode'
}

function expand(dir: string): string {
  return dir.replace(/%([^%]+)%/g, (_, key: string) => process.env[key] ?? '')
}

/** Single-quote for PowerShell ('' escapes a quote inside '...'). */
function psQuote(value: string): string {
  return value.replace(/'/g, "''")
}

function installCommand(spec: LifecycleSpec): string | null {
  const special = INSTALL[spec.id]
  if (special) return special
  if (spec.npmPackage) return `npm install -g ${spec.npmPackage}`
  if (spec.pipPackage) return `pip install -U ${spec.pipPackage}`
  return null
}

/** Commands the tile may offer; every entry has a real, verified command. */
export function lifecycleActions(spec: LifecycleSpec): EngineAction[] {
  const actions: EngineAction[] = []
  const installable = Boolean(installCommand(spec))
  if (installable) actions.push('install')
  if (installable || spec.selfUpdate || NATIVE_UPDATE[spec.id]) actions.push('update')
  if (spec.npmPackage || spec.pipPackage || NATIVE_UNINSTALL[spec.id]) actions.push('uninstall')
  return actions
}

function commandFor(spec: LifecycleSpec, action: EngineAction): string | null {
  if (action === 'install') return installCommand(spec)

  if (action === 'update') {
    // Engine-native updater wins: it knows about version channels npm does not.
    if (spec.selfUpdate) return `${spec.binaries[0]} ${spec.selfUpdate.join(' ')}`
    const native = NATIVE_UPDATE[spec.id]
    if (native) return native
    if (spec.npmPackage) return `npm install -g ${spec.npmPackage}@latest`
    if (spec.pipPackage) return `pip install -U ${spec.pipPackage}`
    // Installer scripts are idempotent → re-running one is the documented update path.
    return INSTALL[spec.id] ?? null
  }

  if (spec.npmPackage) return `npm uninstall -g ${spec.npmPackage}`
  if (spec.pipPackage) return `pip uninstall -y ${spec.pipPackage}`
  return NATIVE_UNINSTALL[spec.id] ?? null
}

export function lifecycleScript(spec: LifecycleSpec, action: EngineAction): LifecycleScript | null {
  const command = commandFor(spec, action)
  if (!command) return null

  // The tile may be clicked before PATH is refreshed; extraPathDirs is exactly
  // where the engine lives, so prepend it instead of trusting a stale PATH.
  const dirs = (spec.extraPathDirs ?? []).map(expand).filter(Boolean).join(';')
  const workDir = RUN_IN[spec.id] ? expand(RUN_IN[spec.id] as string) : ''
  const title = `pqTERM - ${spec.id} - ${action}`
  const done = `[pqTERM] ${action} ${spec.id} - done. Close this window.`

  // pip and the PowerShell installers need PowerShell; npm and batch
  // installers stay in cmd so PATH semantics match what users type by hand.
  const isPs = /^(pip |irm |iwr )/.test(command)

  if (isPs) {
    const body = [
      `$Host.UI.RawUI.WindowTitle = '${psQuote(title)}'`,
      workDir ? `New-Item -ItemType Directory -Force -Path '${psQuote(workDir)}' | Out-Null` : '',
      workDir ? `Set-Location '${psQuote(workDir)}'` : '',
      dirs ? `$env:Path = '${psQuote(dirs)};' + $env:Path` : '',
      command,
      `Write-Host ''`,
      `Write-Host '${psQuote(done)}'`
    ]
      .filter(Boolean)
      .join('\r\n')
    // BOM keeps PowerShell 5.1 from reading the file as ANSI.
    return { kind: 'ps1', body: '\uFEFF' + body + '\r\n' }
  }

  const body = [
    '@echo off',
    'chcp 65001 >nul',
    `title ${title}`,
    workDir ? `if not exist "${workDir}" mkdir "${workDir}"` : '',
    workDir ? `cd /d "${workDir}"` : '',
    dirs ? `set "PATH=${dirs};%PATH%"` : '',
    command,
    'echo.',
    `echo ${done}`
  ]
    .filter(Boolean)
    .join('\r\n')
  return { kind: 'cmd', body: body + '\r\n' }
}

/**
 * PowerShell arguments that re-run a generated script as Administrator (UAC).
 * `Start-Process -Verb RunAs` waits for the consent prompt, so the caller
 * spawns this detached and tells the user to confirm.
 */
export function elevateArgs(kind: 'cmd' | 'ps1', file: string): string[] {
  const script = `"${file.replace(/'/g, "''")}"`
  const inner =
    kind === 'cmd'
      ? ['/d', '/k', script]
      : ['-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', script]
  const list = inner.map((arg) => `'${arg.replace(/'/g, "''")}'`).join(',')
  return [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Start-Process -FilePath '${kind === 'cmd' ? 'cmd.exe' : 'powershell.exe'}' -ArgumentList ${list} -Verb RunAs`
  ]
}
