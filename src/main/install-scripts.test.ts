import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installCommand } from './install-scripts.ts'

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
