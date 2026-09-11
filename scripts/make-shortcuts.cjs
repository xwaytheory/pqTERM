const { existsSync } = require('fs')
const { join } = require('path')
const { spawnSync } = require('child_process')

const root = join(__dirname, '..')
const exe = join(root, 'host', 'pq.exe')
const devCmd = join(root, 'START-dev.cmd')
const desktop = join(process.env.USERPROFILE || '', 'Desktop')

if (!existsSync(exe)) {
  console.error('[pq] stamp host first')
  process.exit(1)
}

const ps = `
$desktop = ${JSON.stringify(desktop)}
$exe = ${JSON.stringify(exe)}
$root = ${JSON.stringify(root)}
$devCmd = ${JSON.stringify(devCmd)}
$w = New-Object -ComObject WScript.Shell

$prod = Join-Path $desktop 'pq-prod.lnk'
$s = $w.CreateShortcut($prod)
$s.TargetPath = $exe
$s.Arguments = '"' + $root + '"'
$s.WorkingDirectory = $root
$s.WindowStyle = 1
$s.Description = 'pq'
$s.IconLocation = $exe + ',0'
$s.Save()

$dev = Join-Path $desktop 'pq-dev.lnk'
$d = $w.CreateShortcut($dev)
$d.TargetPath = $devCmd
$d.Arguments = ''
$d.WorkingDirectory = $root
$d.WindowStyle = 1
$d.Description = 'pq'
$d.IconLocation = $exe + ',0'
$d.Save()

Write-Host '[pq] shortcuts ready'
`
const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
  stdio: 'inherit',
  windowsHide: true
})
if (r.status) process.exit(r.status ?? 1)
