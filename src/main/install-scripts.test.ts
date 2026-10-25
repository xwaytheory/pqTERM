import { test } from 'node:test'
import assert from 'node:assert/strict'
import { elevateArgs, lifecycleActions, lifecycleScript } from './install-scripts.ts'

// Literal specs (not ENGINE_SPECS): engines.ts uses extensionless runtime
// imports, which node --experimental-strip-types cannot resolve. Values mirror
// the real specs; drift is caught by typecheck on `lifecycleActions(spec)`.
const npmSpec = {
  id: 'kimi',
  binaries: ['kimi', 'kimi.cmd'],
  npmPackage: '@moonshot-ai/kimi-code',
  extraPathDirs: ['%APPDATA%\\npm']
} as const
const selfUpdateSpec = {
  id: 'omp',
  binaries: ['omp', 'omp.cmd'],
  npmPackage: '@oh-my-pi/pi-coding-agent',
  selfUpdate: ['update'],
  extraPathDirs: ['%APPDATA%\\npm']
} as const
const pipSpec = {
  id: 'aider',
  binaries: ['aider', 'aider.exe'],
  pipPackage: 'aider-chat',
  extraPathDirs: ['%APPDATA%\\Python']
} as const
const nativeSpec = { id: 'grok', binaries: ['grok', 'grok.exe'], selfUpdate: ['update'] } as const
const hermesSpec = { id: 'hermes', binaries: ['hermes', 'hermes.cmd'] } as const
const shellSpec = { id: 'shell', binaries: ['pwsh', 'powershell'] } as const
const cmdSpec = { id: 'cmd', binaries: ['cmd.exe'] } as const

test('npm CLI: install, update and uninstall all target the same package', () => {
  assert.deepEqual(lifecycleActions(npmSpec), ['install', 'update', 'uninstall'])

  const install = lifecycleScript(npmSpec, 'install')
  assert.equal(install?.kind, 'cmd')
  assert.match(install?.body ?? '', /npm install -g @moonshot-ai\/kimi-code(\r?\n|$)/)
  assert.doesNotMatch(install?.body ?? '', /@latest/)
  assert.match(lifecycleScript(npmSpec, 'update')?.body ?? '', /@moonshot-ai\/kimi-code@latest/)

  assert.match(lifecycleScript(npmSpec, 'uninstall')?.body ?? '', /npm uninstall -g @moonshot-ai\/kimi-code/)
})

test('generated cmd script prepends the engine path dirs', () => {
  const body = lifecycleScript(npmSpec, 'install')?.body ?? ''
  assert.match(body, /set "PATH=.*AppData\\Roaming\\npm;%PATH%"/)
})

test('engine-native updater wins over npm for update', () => {
  const body = lifecycleScript(selfUpdateSpec, 'update')?.body ?? ''
  assert.match(body, /omp update/)
  assert.doesNotMatch(body, /npm install/)
})

test('pip CLI runs in PowerShell and uninstalls cleanly', () => {
  assert.deepEqual(lifecycleActions(pipSpec), ['install', 'update', 'uninstall'])
  const uninstall = lifecycleScript(pipSpec, 'uninstall')
  assert.equal(uninstall?.kind, 'ps1')
  // BOM so PowerShell 5.1 parses the file as UTF-8 instead of ANSI.
  assert.equal(uninstall?.body.charCodeAt(0), 0xfeff)
  assert.match(uninstall?.body ?? '', /pip uninstall -y aider-chat/)
  assert.match(lifecycleScript(pipSpec, 'update')?.body ?? '', /pip install -U aider-chat/)
})

test('native installs expose only the subcommands that really exist', () => {
  assert.deepEqual(lifecycleActions(nativeSpec), ['update'])
  assert.match(lifecycleScript(nativeSpec, 'update')?.body ?? '', /grok update/)
  assert.equal(lifecycleScript(nativeSpec, 'uninstall'), null)

  assert.deepEqual(lifecycleActions(hermesSpec), ['update', 'uninstall'])
  assert.match(lifecycleScript(hermesSpec, 'uninstall')?.body ?? '', /hermes uninstall/)
  assert.match(lifecycleScript(hermesSpec, 'update')?.body ?? '', /hermes update/)
})

test('engines that used to show no hover actions now have install + update', () => {
  const cursor = { id: 'cursor', binaries: ['cursor', 'cursor.exe', 'cursor-agent.cmd'] } as const
  assert.deepEqual(lifecycleActions(cursor), ['install', 'update'])
  assert.match(lifecycleScript(cursor, 'install')?.body ?? '', /cursor\.com\/install\?win32=true/)

  const antigravity = { id: 'antigravity', binaries: ['agy', 'agy.exe'] } as const
  assert.deepEqual(lifecycleActions(antigravity), ['install', 'update'])
  const agy = lifecycleScript(antigravity, 'install')
  assert.equal(agy?.kind, 'cmd')
  assert.match(agy?.body ?? '', /antigravity\.google\/cli\/install\.cmd/)
  assert.match(agy?.body ?? '', /%TEMP%\\agy-install\.cmd/)
  // `call` so the parent script continues (prints done) after the installer.
  assert.match(agy?.body ?? '', /&& call "%TEMP%\\agy-install\.cmd"/)

  const ori = { id: 'ori', binaries: ['ori', 'ori.exe'] } as const
  assert.deepEqual(lifecycleActions(ori), ['install', 'update'])
  assert.match(lifecycleScript(ori, 'install')?.body ?? '', /openrouter\.ai\/labs\/ori\/install\.ps1/)
})

test('CWD-relative installer runs inside the detectable install dir', () => {
  const baicode = {
    id: 'baicode',
    binaries: ['baicode', 'baicode.exe'],
    extraPathDirs: ['%USERPROFILE%\\.baicode\\.venv\\Scripts']
  } as const
  assert.deepEqual(lifecycleActions(baicode), ['install', 'update'])
  const body = lifecycleScript(baicode, 'install')?.body ?? ''
  assert.match(body, /Set-Location '/)
  assert.ok(body.includes('.baicode\''), 'installer runs in ~/.baicode')
  assert.ok(
    body.includes('.baicode\\.venv\\Scripts;'),
    'that venv is on PATH, so the next scan detects baicode'
  )
})

test('every lifecycle window is launched elevated through UAC', () => {
  const cmd = elevateArgs('cmd', 'C:\\Temp\\pq-lifecycle\\kimi-install-1.cmd')
  assert.deepEqual(cmd.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command'])
  const line = cmd[3]
  assert.ok(line.startsWith("Start-Process -FilePath 'cmd.exe'"), line)
  assert.ok(
    line.includes(`-ArgumentList '/d','/k','"C:\\Temp\\pq-lifecycle\\kimi-install-1.cmd"'`),
    line
  )
  assert.ok(line.endsWith('-Verb RunAs'), line)

  const ps1 = elevateArgs('ps1', 'C:\\Users\\Jan Kowalski\\Temp\\ori-install-1.ps1')
  const line2 = ps1[3]
  assert.ok(line2.startsWith("Start-Process -FilePath 'powershell.exe'"), line2)
  assert.ok(
    line2.includes(
      `-ArgumentList '-NoProfile','-NoExit','-ExecutionPolicy','Bypass','-File','"C:\\Users\\Jan Kowalski\\Temp\\ori-install-1.ps1"'`
    ),
    line2
  )
  assert.ok(line2.endsWith('-Verb RunAs'), line2)
})

test('raw shells never get lifecycle buttons', () => {
  for (const spec of [shellSpec, cmdSpec]) {
    assert.deepEqual(lifecycleActions(spec), [])
    for (const action of ['install', 'update', 'uninstall'] as const) {
      assert.equal(lifecycleScript(spec, action), null)
    }
  }
})
