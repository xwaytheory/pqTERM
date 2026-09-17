const { spawnSync } = require('child_process')
const { existsSync } = require('fs')
const { dirname, join, resolve } = require('path')

const root = join(__dirname, '..')
const commonDir = resolve(root, spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).stdout.trim())
const stable = dirname(commonDir)
const devRoot = join(stable, 'instances', 'dev')
const testRoot = join(stable, 'instances', 'test')
const exe = join(stable, 'host', 'pqterm.exe')
const devCmd = join(devRoot, 'START-dev.cmd')
const testCmd = join(testRoot, 'START-dev.cmd')
const desktop = spawnSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8' }).stdout.trim()

if (!existsSync(exe)) {
  console.error('[pqTERM] stamp host first')
  process.exit(1)
}

const ps = `
$desktop = ${JSON.stringify(desktop)}
$exe = ${JSON.stringify(exe)}
$stable = ${JSON.stringify(stable)}
$devRoot = ${JSON.stringify(devRoot)}
$testRoot = ${JSON.stringify(testRoot)}
$devCmd = ${JSON.stringify(devCmd)}
$testCmd = ${JSON.stringify(testCmd)}
$w = New-Object -ComObject WScript.Shell

foreach ($name in @('pq-prod.lnk', 'pq-dev.lnk', 'pqTERM-pr.lnk', 'pqTERM-dev.lnk')) {
  $old = Join-Path $desktop $name
  if (Test-Path $old) { Remove-Item $old -Force }
}

$prod = Join-Path $desktop '1 - pqTERM Oficjalna.lnk'
$s = $w.CreateShortcut($prod)
$s.TargetPath = $exe
$s.Arguments = '"' + $stable + '"'
$s.WorkingDirectory = $stable
$s.WindowStyle = 1
$s.Description = 'pqTERM Oficjalna'
$s.IconLocation = $exe + ',0'
$s.Save()

$dev = Join-Path $desktop '2 - pqTERM DEV.lnk'
$d = $w.CreateShortcut($dev)
$d.TargetPath = $devCmd
$d.Arguments = ''
$d.WorkingDirectory = $devRoot
$d.WindowStyle = 1
$d.Description = 'pqTERM DEV'
$d.IconLocation = $exe + ',0'
$d.Save()

$test = Join-Path $desktop '3 - pqTERM TEST.lnk'
$t = $w.CreateShortcut($test)
$t.TargetPath = $testCmd
$t.Arguments = ''
$t.WorkingDirectory = $testRoot
$t.WindowStyle = 1
$t.Description = 'pqTERM TEST'
$t.IconLocation = $exe + ',0'
$t.Save()

Write-Host '[pqTERM] shortcuts ready'
`
const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
  stdio: 'inherit',
  windowsHide: true
})
if (r.status) process.exit(r.status ?? 1)
