import type { EngineId, ModelChoice, ProviderInfo } from '../shared/types'
import { isRawShell } from '../shared/types'
import { lifecycleActions } from './install-scripts'

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
  /**
   * Optional brand mark path (e.g. `resources/engines/<id>.svg`) for letter-mark chips.
   * Prefer abstract monograms over vendor wordmarks (trademark). See docs/LOGOS-INVENTORY.md.
   */
  logo?: string
  /** Optional window/taskbar-style icon path; falls back to `logo` / color chip. */
  icon?: string
  /** Optional monogram (1–2 chars) for letter-mark chips; set for first-letter collisions. */
  mark?: string
}

export const ENGINE_SPECS: EngineSpec[] = [
  {
    id: 'grok',
    name: 'Grok CLI',
    vendor: 'xAI',
    color: '#39ffb6',
    mark: 'Gr',
    binaries: ['grok', 'grok.exe'],
    args: ['--always-approve', '--trust'],
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
    mark: 'Om',
    binaries: ['omp', 'omp.cmd'],
    args: ['--yolo'],
    hint: 'Oh My Pi — open-source terminal coding agent',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: '@oh-my-pi/pi-coding-agent',
    selfUpdate: ['update'],
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
    id: 'pi',
    name: 'Pi',
    vendor: 'Earendil',
    color: '#4d9abf',
    binaries: ['pi', 'pi.cmd'],
    args: ['--approve'],
    hint: 'Pi — minimalny, rozszerzalny agent terminalowy (pi.dev). Instalacja: powershell -c "irm https://pi.dev/install.ps1 | iex" albo npm i -g --ignore-scripts @earendil-works/pi-coding-agent (Node ≥22.19). Login: /login w środku.',
    extraPathDirs: ['%APPDATA%\\npm', '%LOCALAPPDATA%\\pi-node\\current'],
    npmPackage: '@earendil-works/pi-coding-agent',
    selfUpdate: ['update'],
    models: []
  },
  {
    id: 'hermes',
    name: 'Hermes',
    vendor: 'Nous / Hermes',
    color: '#f5c542',
    binaries: ['hermes', 'hermes.cmd'],
    args: ['--yolo', '--accept-hooks'],
    hint: 'Hermes agent CLI. Same as typing `hermes` in CMD. LongCat: jednorazowo `hermes config set model.provider custom` + base_url https://api.longcat.chat/openai/v1 + api_key z longcat.chat',
    modelFlag: (id) => (id === 'LongCat-2.0' ? ['-m', id, '--provider', 'custom'] : ['-m', id]),
    extraPathDirs: ['%LOCALAPPDATA%\\hermes\\bin'],
    models: [
      { id: 'LongCat-2.0', name: 'LongCat 2.0 (free)' },
      { id: 'hermes-default', name: 'Hermes default' },
      { id: 'hermes-large', name: 'Hermes large' }
    ]
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    vendor: 'OpenCode',
    color: '#7aa2ff',
    mark: 'Oc',
    binaries: ['opencode', 'opencode.cmd'],
    args: ['--auto'],
    hint: 'OpenCode TUI — konta i klucze z lokalnej sesji',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: 'opencode-ai',
    selfUpdate: ['upgrade'],
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
    mark: 'Cx',
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
    mark: 'Cl',
    binaries: ['claude', 'claude.cmd'],
    args: ['--dangerously-skip-permissions'],
    hint: 'Claude Code TUI',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: '@anthropic-ai/claude-code',
    selfUpdate: ['update'],
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
    args: ['--profile', 'web'],
    hint: 'dsh — oficjalny OSS harness DeepSeek (profil web: serwer UI lokalnie, URL w terminalu)',
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
    mark: 'Ge',
    binaries: ['gemini', 'gemini.cmd'],
    args: ['--yolo', '--skip-trust'],
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
    mark: 'Cr',
    binaries: ['crush', 'crush.cmd'],
    args: ['--yolo'],
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
    args: ['--yes-always'],
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
    mark: 'Co',
    binaries: ['copilot', 'copilot.cmd'],
    args: ['--yolo'],
    hint: 'GitHub Copilot CLI',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: '@github/copilot',
    models: []
  },
  {
    id: 'antigravity',
    name: 'Antigravity CLI',
    vendor: 'Google',
    color: '#ea4335',
    mark: 'Ag',
    binaries: ['agy', 'agy.exe'],
    args: ['--dangerously-skip-permissions'],
    hint: 'Antigravity CLI (agy) — TUI Google. Instalacja: curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd. Logowanie przez keyring/Google przy pierwszym starcie.',
    extraPathDirs: ['%LOCALAPPDATA%\\agy\\bin'],
    models: []
  },
  {
    id: 'zcode',
    name: 'ZCode',
    vendor: 'Z.AI',
    color: '#ff8c1a',
    binaries: ['zcode', 'zcode.cmd'],
    args: ['--mode', 'yolo'],
    hint: 'ZCode (Z.AI, GLM) — TUI. Instalacja: npm install -g zcode-app-cli. Setup wizard przy pierwszym starcie (/setup wraca do kreatora).',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: 'zcode-app-cli',
    models: []
  },
  {
    id: 'ori',
    name: 'Ori',
    vendor: 'OpenRouter',
    color: '#8b5cf6',
    mark: 'Or',
    binaries: ['ori', 'ori.exe'],
    args: ['code', '-i', '--tty', '--approvals', 'self-drive'],
    hint: 'Ori Code (OpenRouter) — natywny coding agent. Instalacja (Windows): irm https://openrouter.ai/labs/ori/install.ps1 | iex',
    extraPathDirs: ['%USERPROFILE%\\.local\\bin'],
    modelFlag: (id) => ['--model', id],
    models: [
      { id: 'anthropic/claude-sonnet-4', name: 'Sonnet 4' },
      { id: 'anthropic/claude-opus-4', name: 'Opus 4' },
      { id: 'openai/gpt-5', name: 'GPT-5' },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { id: 'xai/grok-4', name: 'Grok 4' }
    ]
  },
  {
    id: 'freebuff',
    name: 'Freebuff',
    vendor: 'Freebuff',
    color: '#00d4aa',
    binaries: ['freebuff', 'freebuff.cmd'],
    args: ['--trust-agents'],
    hint: 'Freebuff — AI coding agent. Install: npm install -g freebuff',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: 'freebuff',
    models: []
  },
  {
    id: 'kimi',
    name: 'Kimi Code',
    vendor: 'Moonshot AI',
    color: '#e85d75',
    binaries: ['kimi', 'kimi.cmd'],
    args: ['--auto'],
    hint: 'Kimi Code — Moonshot AI coding agent',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: '@moonshot-ai/kimi-code',
    models: []
  },
  {
    id: 'cline',
    name: 'Cline CLI',
    vendor: 'Cline',
    color: '#3b82f6',
    binaries: ['cline', 'cline.cmd'],
    args: ['--auto-approve', 'true'],
    hint: 'Cline CLI — autonomous coding agent (npm install -g cline)',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: 'cline',
    models: []
  },
  {
    id: 'qoder',
    name: 'Qoder CLI',
    vendor: 'Alibaba / Qoder',
    color: '#2adb5c',
    mark: 'Qd',
    binaries: ['qodercli', 'qodercli.exe'],
    args: ['--yolo'],
    hint: 'Qoder CLI — oficjalny instalator Windows: irm https://qoder-ide.oss-accelerate.aliyuncs.com/qodercli/install.ps1 | iex',
    extraPathDirs: ['%USERPROFILE%\\.qoder\\bin\\qodercli'],
    selfUpdate: ['install', '--force'],
    models: []
  },
  {
    id: 'baicode',
    name: 'BAI code',
    vendor: 'B.AI',
    color: '#cdbd09',
    binaries: ['baicode', 'baicode.exe'],
    args: [],
    hint: 'BAI code — CLI od B.AI (klient OpenAI-compatible; wymaga BAI_API_KEY)',
    // Official installer creates .venv in the CWD → install-scripts pins it here.
    extraPathDirs: ['%USERPROFILE%\\.baicode\\.venv\\Scripts'],
    models: []
  },
  {
    id: 'cursor',
    name: 'Cursor CLI',
    vendor: 'Anysphere',
    color: '#2563eb',
    mark: 'Cu',
    binaries: ['cursor', 'cursor.exe', 'cursor-agent', 'cursor-agent.exe', 'cursor-agent.cmd'],
    args: ['--yolo', '--approve-mcps'],
    hint: "Cursor Agent CLI — instalacja (Windows): irm 'https://cursor.com/install?win32=true' | iex",
    extraPathDirs: ['%LOCALAPPDATA%\\cursor-agent', '%LOCALAPPDATA%\\Cursor\\resources\\app\\bin', '%APPDATA%\\npm'],
    modelFlag: (id) => ['--model', id],
    models: [
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
      { id: 'gpt-5.5', name: 'GPT-5.5' },
      { id: 'claude-opus-5', name: 'Opus 5' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'grok-4.6', name: 'Grok 4.6' }
    ]
  },
  {
    id: 'kilocode',
    name: 'Kilo Code',
    vendor: 'Kilo',
    color: '#e6e6e6',
    mark: 'Kc',
    // npm exposes both names (`kilocode` and `kilo`) for the same shim.
    binaries: ['kilocode', 'kilocode.cmd', 'kilo', 'kilo.cmd'],
    args: ['--auto'],
    hint: 'Kilo Code CLI — npm install -g @kilocode/cli (komendy: kilocode / kilo)',
    extraPathDirs: ['%APPDATA%\\npm'],
    npmPackage: '@kilocode/cli',
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
  },
  {
    id: 'cmd',
    name: 'cmd',
    vendor: 'Windows',
    color: '#4ec9b0',
    binaries: ['cmd.exe'],
    args: ['/K'],
    hint: 'Czysty cmd — bez agenta',
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
    logo: spec.logo,
    icon: spec.icon,
    mark: spec.mark,
    installed: false,
    actions: lifecycleActions(spec),
    detectedAuth: false,
    enabled: !isRawShell(spec.id),
    models: spec.models.map((m) => ({ ...m, enabled: true })),
    hint: spec.hint,
    ...extras
  }
}
