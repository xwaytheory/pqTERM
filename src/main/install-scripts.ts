import type { EngineId } from '../shared/types'

/**
 * One click on an undetected CLI opens a visible cmd/PowerShell window running
 * the official install command. pqTERM does not install, track or uninstall —
 * the user sees the whole run. Null = no scripted install; the tile hint names
 * the official installer instead.
 */
export function installCommand(id: EngineId): { exe: string; args: string[]; script: string } | null {
  const scripts: Partial<Record<EngineId, string>> = {
    omp: 'npm install -g @oh-my-pi/pi-coding-agent',
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
    kimi: 'npm install -g @moonshot-ai/kimi-code'
  }
  const script = scripts[id]
  if (!script) return null
  // pip lives in PowerShell (native Windows); npm needs cmd's /k so the window
  // stays open when the install fails and the error stays readable.
  const isPip = script.startsWith('pip ')
  return {
    exe: isPip ? 'powershell.exe' : 'cmd.exe',
    args: isPip ? ['/NoProfile', '-NoExit', '-Command', script] : ['/d', '/s', '/k', script],
    script
  }
}
