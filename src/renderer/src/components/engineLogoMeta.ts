/**
 * Engine ids with a built-in brand mark in `assets/engines/`.
 * Keep in sync: every EngineId in shared `ENGINE_ORDER` must have a file
 * (guarded by `engineLogoMeta.test.ts`, which also checks the files exist).
 */
export const ENGINE_LOGO_IDS = [
  'grok',
  'omp',
  'hermes',
  'opencode',
  'codex',
  'claude',
  'qwen',
  'dsh',
  'gemini',
  'crush',
  'aider',
  'copilot',
  'antigravity',
  'zcode',
  'ori',
  'cursor',
  'shell'
] as const

export type EngineLogoId = (typeof ENGINE_LOGO_IDS)[number]

export const ENGINE_LOGO_FILES: Record<EngineLogoId, string> = {
  grok: 'grok.svg',
  omp: 'omp.svg',
  hermes: 'hermes.png',
  opencode: 'opencode.svg',
  codex: 'codex.png',
  claude: 'claude.png',
  qwen: 'qwen.png',
  dsh: 'dsh.svg',
  gemini: 'gemini.svg',
  crush: 'crush.png',
  aider: 'aider.png',
  copilot: 'copilot.svg',
  antigravity: 'antigravity.png',
  zcode: 'zcode.png',
  ori: 'ori.png',
  cursor: 'cursor.svg',
  shell: 'shell.svg'
}
