import type { EngineId, ModelChoice, ProviderInfo } from '../shared/types'

export interface EngineSpec {
  id: EngineId
  name: string
  vendor: string
  color: string
  binaries: string[]
  args: string[]
  hint: string
  models: Omit<ModelChoice, 'enabled'>[]
  extraPathDirs: string[]
  modelFlag?: (modelId: string) => string[]
  npmPackage?: string
  pipPackage?: string
  selfUpdate?: string[]
}

export const ENGINE_SPECS: EngineSpec[] = [
  {
    id: 'grok',
    name: 'Grok CLI',
    vendor: 'xAI',
    color: '#39ffb6',
    binaries: ['grok', 'grok.exe'],
    args: ['--always-approve'],
    hint: 'Grok Build TUI — sesja lokalna z ~/.grok',
    extraPathDirs: ['%USERPROFILE%\\.grok\\bin'],
    selfUpdate: ['update'],
    modelFlag: (id) => ['-m', id],
    models: [
      { id: 'grok-4.6', name: 'Grok 4.6' },
      { id: 'grok-4.5', name: 'Grok 4.5' },
      { id: 'grok-4-fast', name: 'Grok 4 Fast' },
      { id: 'grok-code', name: 'Grok Code' }
    ]
  },
  {
    id: 'omp',
    name: 'Omp',
    vendor: 'oh-my-pi',
    color: '#c084fc',
    binaries: ['omp', 'omp.cmd'],
    args: ['--yolo'],
    hint: 'Oh My Pi — open-source terminal coding agent',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: '@oh-my-pi/pi-coding-agent',
    modelFlag: (id) => ['--model', id],
    models: [
      { id: 'anthropic/claude-sonnet-4', name: 'Sonnet 4' },
      { id: 'openai/gpt-5', name: 'GPT-5' },
      { id: 'xai/grok-4', name: 'Grok 4' },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'zhipuai/glm-4.7', name: 'GLM 4.7' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek' }
    ]
  },
  {
    id: 'hermes',
    name: 'Hermes',
    vendor: 'Nous / Hermes',
    color: '#f5c542',
    binaries: ['hermes', 'hermes.cmd'],
    args: ['--tui', '--yolo'],
    hint: 'Hermes agent CLI (TUI)',
    modelFlag: (id) => ['-m', id],
    extraPathDirs: ['%LOCALAPPDATA%\\hermes\\bin'],
    models: [
      { id: 'hermes-default', name: 'Hermes default' },
      { id: 'hermes-large', name: 'Hermes large' }
    ]
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    vendor: 'OpenCode',
    color: '#7aa2ff',
    binaries: ['opencode', 'opencode.cmd'],
    args: ['--yolo'],
    hint: 'OpenCode TUI — konta i klucze z lokalnej sesji',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: 'opencode-ai',
    modelFlag: (id) => ['--model', id],
    models: [
      { id: 'opencode-default', name: 'OpenCode default' },
      { id: 'anthropic/claude-sonnet-4', name: 'Sonnet 4' },
      { id: 'openai/gpt-5', name: 'GPT-5' },
      { id: 'xai/grok-4', name: 'Grok 4' },
      { id: 'zhipuai/glm-4.7', name: 'GLM 4.7' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek' }
    ]
  },
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    color: '#9ae6b4',
    binaries: ['codex', 'codex.cmd'],
    args: ['--yolo'],
    hint: 'OpenAI Codex CLI',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: '@openai/codex',
    modelFlag: (id) => ['--model', id],
    models: [
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
      { id: 'gpt-5.5', name: 'GPT-5.5' },
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'codex-mini', name: 'Codex mini' }
    ]
  },
  {
    id: 'claude',
    name: 'Claude Code',
    vendor: 'Anthropic',
    color: '#d4a574',
    binaries: ['claude', 'claude.cmd'],
    args: ['--dangerously-skip-permissions'],
    hint: 'Claude Code TUI',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: '@anthropic-ai/claude-code',
    modelFlag: (id) => ['--model', id],
    models: [
      { id: 'claude-sonnet-4', name: 'Sonnet 4' },
      { id: 'claude-opus-4', name: 'Opus 4' },
      { id: 'claude-haiku-4', name: 'Haiku 4' }
    ]
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    vendor: 'Alibaba / Qwen',
    color: '#7c5cff',
    binaries: ['qwen', 'qwen.cmd'],
    args: ['--yolo'],
    hint: 'Qwen Code — OSS agent (Qwen + OpenAI/Anthropic/Gemini compatible)',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: '@qwen-code/qwen-code',
    modelFlag: (id) => ['--model', id],
    models: [
      { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus' },
      { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus' }
    ]
  },
  {
    id: 'dsh',
    name: 'DeepSeek Harness',
    vendor: 'DeepSeek',
    color: '#4cc9f0',
    binaries: ['dsh', 'dsh.cmd'],
    args: ['--profile', 'tui'],
    hint: 'dsh — oficjalny OSS harness DeepSeek (TUI profile)',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: '@deepseek-ai/dsh',
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }
    ]
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    vendor: 'Google',
    color: '#4285f4',
    binaries: ['gemini', 'gemini.cmd'],
    args: ['--yolo'],
    hint: 'Gemini CLI (OSS). Consumer Gemini CLI jest wygaszany — zostawiamy binarkę jeśli działa.',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: '@google/gemini-cli',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }
    ]
  },
  {
    id: 'crush',
    name: 'Crush',
    vendor: 'Charmbracelet',
    color: '#ff387b',
    binaries: ['crush', 'crush.cmd'],
    args: [],
    hint: 'Crush — OSS TUI Charmbracelet, multi-provider',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: '@charmland/crush',
    models: []
  },
  {
    id: 'aider',
    name: 'Aider',
    vendor: 'Aider-AI',
    color: '#e8c547',
    binaries: ['aider', 'aider.exe'],
    args: ['--yes'],
    hint: 'Aider — git-native OSS pair programmer (pip)',
    extraPathDirs: ['%APPDATA%\\Python', '%LOCALAPPDATA%\\Programs\\Python'],
    pipPackage: 'aider-chat',
    models: []
  },
  {
    id: 'copilot',
    name: 'Copilot CLI',
    vendor: 'GitHub',
    color: '#f0f6fc',
    binaries: ['copilot', 'copilot.cmd'],
    args: ['--yolo'],
    hint: 'GitHub Copilot CLI',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: '@github/copilot',
    models: []
  },
  {
    id: 'shell',
    name: 'PowerShell',
    vendor: 'Windows',
    color: '#5b9fd6',
    binaries: ['pwsh', 'powershell'],
    args: ['-NoLogo'],
    hint: 'Czysty shell — bez agenta',
    extraPathDirs: [],
    models: []
  }
]

export function specById(id: EngineId): EngineSpec {
  const spec = ENGINE_SPECS.find((s) => s.id === id)
  if (!spec) throw new Error(`unknown engine ${id}`)
  return spec
}

export function defaultProvider(spec: EngineSpec, extras?: Partial<ProviderInfo>): ProviderInfo {
  return {
    id: spec.id,
    name: spec.name,
    vendor: spec.vendor,
    command: spec.binaries[0],
    args: spec.args,
    color: spec.color,
    installed: false,
    detectedAuth: false,
    enabled: spec.id !== 'shell',
    models: spec.models.map((m) => ({ ...m, enabled: true })),
    hint: spec.hint,
    ...extras
  }
}
