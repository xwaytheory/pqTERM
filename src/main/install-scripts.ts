import type { EngineAction, EngineId } from '../shared/types'

/**
 * One click on a CLI tile opens a visible cmd/PowerShell window running the
 * official install / update / uninstall command. pqTERM does not install,
 * track or uninstall anything itself — the user sees the whole run.
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
}

const INSTALL: Partial<Record<EngineId, string>> = {
  omp: 'npm install -g @oh-my-pi/pi-coding-agent',
  pi: 'irm https://pi.dev/install.ps1 | iex',
  opencode: 'npm install -g opencode-ai',
  codex: 'npm install -g @openai/codex',
  claude: 'npm install -g @anthropic-ai/claude-code',
  qwen: 'npm install -g @qwen-code/qwen-code',
  dsh: 'npm install -g @deepseek-ai/dsh',
  gemini: 'npm install -g @google/gemini-cli',
  crush: 'npm install -g @charmland/crush',
  aider: 'pip install -U aider-chat',
  copilot: 'npm install -g @github/copilot',
  zcode: 'npm install -g zcode-app-cli',
  freebuff: 'npm install -g freebuff',
  kimi: 'npm install -g @moonshot-ai/kimi-code',
  cline: 'npm install -g cline',
  qoder: 'irm https://qoder-ide.oss-accelerate.aliyuncs.com/qodercli/install.ps1 | iex',
  baicode:
    'iwr -useb https://raw.githubusercontent.com/BAI-labs/BAI-tools/main/scripts/baicode_install.ps1 | iex'
}

/** Official self-uninstall subcommands for native installs (verified via --help). */
const NATIVE_UNINSTALL: Partial<Record<EngineId, string>> = {
  hermes: 'hermes uninstall'
}

/** Native updaters for engines that ship no selfUpdate args in their spec. */
const NATIVE_UPDATE: Partial<Record<EngineId, string>> = {
  hermes: 'hermes update'
}

function open(script: string): { exe: string; args: string[]; script: string } {
  // pip and the PowerShell installers live in PowerShell (native Windows);
  // npm needs cmd's /k so the window stays open when the command fails and
  // the error stays readable.
  const isPs = /^(pip |irm |iwr )/.test(script)
  return {
    exe: isPs ? 'powershell.exe' : 'cmd.exe',
    args: isPs ? ['/NoProfile', '-NoExit', '-Command', script] : ['/d', '/s', '/k', script],
    script
  }
}

export function installCommand(id: EngineId): { exe: string; args: string[]; script: string } | null {
  const script = INSTALL[id]
  return script ? open(script) : null
}

/** Which lifecycle buttons the tile is allowed to show (no dead buttons). */
export function lifecycleActions(spec: LifecycleSpec): EngineAction[] {
  const actions: EngineAction[] = []
  if (INSTALL[spec.id]) actions.push('install')
  if (spec.selfUpdate || spec.npmPackage || spec.pipPackage || INSTALL[spec.id] || NATIVE_UPDATE[spec.id]) {
    actions.push('update')
  }
  if (spec.npmPackage || spec.pipPackage || NATIVE_UNINSTALL[spec.id]) actions.push('uninstall')
  return actions
}

export function lifecycleCommand(
  spec: LifecycleSpec,
  action: EngineAction
): { exe: string; args: string[]; script: string } | null {
  if (action === 'install') return installCommand(spec.id)

  if (action === 'update') {
    // Engine-native updater wins: it knows about version channels npm does not.
    if (spec.selfUpdate) return open(`${spec.binaries[0]} ${spec.selfUpdate.join(' ')}`)
    const native = NATIVE_UPDATE[spec.id]
    if (native) return open(native)
    if (spec.npmPackage) return open(`npm install -g ${spec.npmPackage}@latest`)
    if (spec.pipPackage) return open(`pip install -U ${spec.pipPackage}`)
    return installCommand(spec.id)
  }

  if (spec.npmPackage) return open(`npm uninstall -g ${spec.npmPackage}`)
  if (spec.pipPackage) return open(`pip uninstall -y ${spec.pipPackage}`)
  const native = NATIVE_UNINSTALL[spec.id]
  return native ? open(native) : null
}
