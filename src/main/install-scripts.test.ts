import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installCommand, lifecycleActions, lifecycleCommand } from './install-scripts.ts'

// Literal specs (not ENGINE_SPECS): engines.ts uses extensionless runtime
// imports, which node --experimental-strip-types cannot resolve. Values mirror
// the real specs; drift is caught by typecheck on `lifecycleActions(spec)`.
const npmSpec = { id: 'kimi', binaries: ['kimi', 'kimi.cmd'], npmPackage: '@moonshot-ai/kimi-code' } as const
const selfUpdateSpec = { id: 'omp', binaries: ['omp', 'omp.cmd'], npmPackage: '@oh-my-pi/pi-coding-agent', selfUpdate: ['update'] } as const
const pipSpec = { id: 'aider', binaries: ['aider', 'aider.exe'], pipPackage: 'aider-chat' } as const
const nativeSpec = { id: 'grok', binaries: ['grok', 'grok.exe'], selfUpdate: ['update'] } as const
const hermesSpec = { id: 'hermes', binaries: ['hermes', 'hermes.cmd'] } as const
const shellSpec = { id: 'shell', binaries: ['pwsh', 'powershell'] } as const
const cmdSpec = { id: 'cmd', binaries: ['cmd.exe'] } as const

// The install window runs whatever command this returns — the user sees it and
// trusts it, so every entry must name the official package exactly.

test('npm CLIs get a cmd /k window with the official package', () => {
  const kimi = installCommand('kimi')
  assert.ok(kimi)
  assert.equal(kimi.exe, 'cmd.exe')
  assert.deepEqual(kimi.args, ['/d', '/s', '/k', 'npm install -g @moonshot-ai/kimi-code'])

  const claude = installCommand('claude')
  assert.ok(claude?.script.includes('@anthropic-ai/claude-code'))
})

test('pip CLI gets a PowerShell window that stays open', () => {
  const aider = installCommand('aider')
  assert.ok(aider)
  assert.equal(aider.exe, 'powershell.exe')
  assert.deepEqual(aider.args, ['/NoProfile', '-NoExit', '-Command', 'pip install -U aider-chat'])
})

test('pi gets the official Windows installer in a PowerShell window', () => {
  const pi = installCommand('pi')
  assert.ok(pi)
  assert.equal(pi.exe, 'powershell.exe')
  assert.deepEqual(pi.args, ['/NoProfile', '-NoExit', '-Command', 'irm https://pi.dev/install.ps1 | iex'])
})

test('native-only engines have no scripted install', () => {
  for (const id of ['grok', 'hermes', 'antigravity', 'ori', 'cursor', 'shell', 'cmd'] as const) {
    assert.equal(installCommand(id), null, `${id} must not fake a scripted install`)
  }
})

test('npm CLI: install, update and uninstall all target the same package', () => {
  assert.deepEqual(lifecycleActions(npmSpec), ['install', 'update', 'uninstall'])
  assert.deepEqual(lifecycleCommand(npmSpec, 'install')?.args, [
    '/d',
    '/s',
    '/k',
    'npm install -g @moonshot-ai/kimi-code'
  ])
  assert.equal(lifecycleCommand(npmSpec, 'update')?.script, 'npm install -g @moonshot-ai/kimi-code@latest')
  assert.equal(lifecycleCommand(npmSpec, 'uninstall')?.script, 'npm uninstall -g @moonshot-ai/kimi-code')
  assert.equal(lifecycleCommand(npmSpec, 'uninstall')?.exe, 'cmd.exe')
})

test('engine-native updater wins over npm for update', () => {
  assert.equal(lifecycleCommand(selfUpdateSpec, 'update')?.script, 'omp update')
})

test('pip CLI uninstalls through PowerShell', () => {
  assert.deepEqual(lifecycleActions(pipSpec), ['install', 'update', 'uninstall'])
  assert.equal(lifecycleCommand(pipSpec, 'uninstall')?.exe, 'powershell.exe')
  assert.equal(lifecycleCommand(pipSpec, 'uninstall')?.script, 'pip uninstall -y aider-chat')
  assert.equal(lifecycleCommand(pipSpec, 'update')?.script, 'pip install -U aider-chat')
})

test('native installs expose only the subcommands that really exist', () => {
  assert.deepEqual(lifecycleActions(nativeSpec), ['update'])
  assert.equal(lifecycleCommand(nativeSpec, 'update')?.script, 'grok update')
  assert.equal(lifecycleCommand(nativeSpec, 'uninstall'), null)

  assert.deepEqual(lifecycleActions(hermesSpec), ['update', 'uninstall'])
  assert.equal(lifecycleCommand(hermesSpec, 'uninstall')?.script, 'hermes uninstall')
})

test('raw shells never get lifecycle buttons', () => {
  for (const spec of [shellSpec, cmdSpec]) {
    assert.deepEqual(lifecycleActions(spec), [])
    for (const action of ['install', 'update', 'uninstall'] as const) {
      assert.equal(lifecycleCommand(spec, action), null)
    }
  }
})
