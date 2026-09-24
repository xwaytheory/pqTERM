const { spawnSync } = require('child_process')
const { existsSync } = require('fs')
const { dirname, join, resolve } = require('path')

const root = join(__dirname, '..')
const commonDir = resolve(root, spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).stdout.trim())
const stable = dirname(commonDir)
const devRoot = join(stable, 'instances', 'dev')
const testRoot = join(stable, 'instances', 'test')
const exe = join(stable, 'host', 'pqterm.exe')
const shortcutIco = join(stable, 'resources', 'brand', 'pq-desktop.ico')
const devCmd = join(devRoot, 'START-dev.cmd')
const testCmd = join(testRoot, 'START-dev.cmd')
const desktop = spawnSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8' }).stdout.trim()

// PowerShell single quotes are literal — JSON.stringify would hand it C:\\Users\...
// (PowerShell does not escape backslashes), which Windows only tolerates.
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

if (!existsSync(exe)) {
  console.error('[pqTERM] stamp host first')
  process.exit(1)
}

const ps = `
$desktop = ${psQuote(desktop)}
$exe = ${psQuote(exe)}
$stable = ${psQuote(stable)}
$devRoot = ${psQuote(devRoot)}
$testRoot = ${psQuote(testRoot)}
$devCmd = ${psQuote(devCmd)}
$testCmd = ${psQuote(testCmd)}
$icon = ${psQuote(existsSync(shortcutIco) ? shortcutIco : `${exe},0`)}
$w = New-Object -ComObject WScript.Shell

foreach ($name in @('pq-prod.lnk', 'pq-dev.lnk', 'pqTERM-pr.lnk', 'pqTERM-dev.lnk', '1 - pqTERM Oficjalna.lnk', '1 - pqTERM Oficjalna (START-pr).lnk', '2 - pqTERM DEV.lnk', '3 - pqTERM TEST.lnk')) {
  $old = Join-Path $desktop $name
  if (Test-Path $old) { Remove-Item $old -Force }
}

$prod = Join-Path $desktop '1 - pqTERM pr.lnk'
$s = $w.CreateShortcut($prod)
$s.TargetPath = $exe
$s.Arguments = '"' + $stable + '"'
$s.WorkingDirectory = $stable
$s.WindowStyle = 1
$s.Description = 'pqTERM pr — oficjalna (profil pqTERM-pr)'
$s.IconLocation = $icon
$s.Save()

$dev = Join-Path $desktop '2 - pqTERM dev.lnk'
$d = $w.CreateShortcut($dev)
$d.TargetPath = $devCmd
$d.Arguments = ''
$d.WorkingDirectory = $devRoot
$d.WindowStyle = 1
$d.Description = 'pqTERM dev (profil pqTERM-dev)'
$d.IconLocation = $icon
$d.Save()

$test = Join-Path $desktop '3 - pqTERM test.lnk'
$t = $w.CreateShortcut($test)
$t.TargetPath = $testCmd
$t.Arguments = ''
$t.WorkingDirectory = $testRoot
$t.WindowStyle = 1
$t.Description = 'pqTERM test (worktree test)'
$t.IconLocation = $icon
$t.Save()

Write-Host '[pqTERM] shortcuts ready'
`
const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
  stdio: 'inherit',
  windowsHide: true
})
if (r.status) process.exit(r.status ?? 1)
