import { spawn } from 'child_process'
import { once } from 'events'
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { EngineId, EngineOperation, EngineResult, ProviderInfo } from '../shared/types'
import { ENGINE_SPECS, type EngineSpec } from './engines'

const OWNER = '.pqterm-install.json'
const LOCK = '.pqterm-cli.lock'
/** Two app editions share %LOCALAPPDATA%\pqTERM\cli — a lock file serializes them. */
let lockFd: number | null = null
function acquireLock(): boolean {
  if (lockFd !== null) return false
  const path = join(rootDir(), LOCK)
  try {
    mkdirSync(rootDir(), { recursive: true })
    lockFd = openSync(path, 'wx')
    return true
  } catch {
    try {
      if (Date.now() - statSync(path).mtimeMs > 15 * 60_000) { // ponytail: stale-lock adoption assumes no CLI op runs >15min; raise with the timeout
        unlinkSync(path)
        return acquireLock()
      }
    } catch { /* stat failed — treat as busy */ }
    return false
  }
}
function releaseLock(): void {
  if (lockFd === null) return
  try { closeSync(lockFd); unlinkSync(join(rootDir(), LOCK)) } catch { /* best effort */ }
  lockFd = null
}
let busy = false

function rootDir(): string {
  return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'pqTERM', 'cli')
}

function installationDir(id: EngineId): string {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || !ENGINE_SPECS.some((s) => s.id === id)) {
    throw new Error('Unknown CLI identifier.')
  }
  return join(resolve(rootDir()), id)
}


/** Refuse redirected ancestors as well as a redirected installation/ownership marker. */
function safePath(path: string): void {
  let current = resolve(path)
  while (true) {
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Redirected path; refusing to modify: ${current}`)
      const actual = realpathSync(current)
      if (process.platform === 'win32' ? actual.toLowerCase() !== current.toLowerCase() : actual !== current) {
        throw new Error(`Redirected path; refusing to modify: ${current}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

function ownedInstallation(spec: EngineSpec): boolean {
  const dir = installationDir(spec.id)
  safePath(dir)
  if (!existsSync(dir)) return false
  if (!lstatSync(dir).isDirectory()) throw new Error('Installation path is not a directory.')
  const marker = join(dir, OWNER)
  safePath(marker)
  try {
    const record = JSON.parse(readFileSync(marker, 'utf8'))
    return record.owner === 'pqTERM' && record.id === spec.id &&
      record.packageName === (spec.npmPackage || spec.pipPackage)
  } catch { return false }
}

function file(path: string): boolean {
  try { return statSync(path).isFile() } catch { return false }
}

function expand(path: string): string {
  return path.replace(/%USERPROFILE%/gi, homedir())
    .replace(/%APPDATA%/gi, process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'))
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'))
}

function pathDirs(extra: string[] = []): string[] {
  return [...extra.map(expand), ...(process.env.PATH || process.env.Path || '').split(delimiter)]
    .map((dir) => dir.replace(/^"|"$/g, '')).filter((dir) => isAbsolute(dir))
}

function findFile(names: string[], dirs: string[]): string | null {
  for (const dir of dirs) {
    for (const name of names) {
      const path = join(dir, name)
      if (file(path)) return path
    }
  }
  return null
}

function externalCommand(spec: EngineSpec): string | null {
  const names = (spec.binaries ?? []).flatMap((name) => /\.(exe|cmd|bat)$/i.test(name)
    ? [name] : process.platform === 'win32' ? [name + '.exe', name + '.cmd', name + '.bat'] : [name])
  return findFile(names, pathDirs(spec.extraPathDirs))
}

function npmRuntime(): { node: string; cli: string } | null {
  const dirs = pathDirs([
    '%LOCALAPPDATA%\\Programs\\nodejs',
    ...(process.env.ProgramFiles ? [join(process.env.ProgramFiles, 'nodejs')] : []),
    '%APPDATA%\\npm'
  ])
  // Prefer the actual PATH-selected Node installation; npm need not live in Roaming/npm.
  const node = findFile([process.platform === 'win32' ? 'node.exe' : 'node'], pathDirs()) ||
    findFile([process.platform === 'win32' ? 'node.exe' : 'node'], dirs)
  if (!node) return null
  const candidates = [dirname(node), dirname(realpathSync(node)), ...dirs]
  for (const dir of candidates) {
    for (const cli of [join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]) {
      if (file(cli)) return { node, cli }
    }
  }
  return null
}

function uvCommand(): string | null {
  return findFile([process.platform === 'win32' ? 'uv.exe' : 'uv'], pathDirs([
    '%USERPROFILE%\\.local\\bin', '%USERPROFILE%\\.cargo\\bin'
  ]))
}

function within(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
}

export function managedCommand(id: EngineId): string | null {
  const spec = ENGINE_SPECS.find((s) => s.id === id)
  if (!spec) return null
  try {
    if (!ownedInstallation(spec)) return null
    const dir = installationDir(id)
    if (spec.npmPackage) {
      const pkgDir = join(dir, 'node_modules', ...spec.npmPackage.split('/'))
      const pkg = file(join(pkgDir, 'package.json')) ? JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) : {}
      const bins: Record<string, unknown> = typeof pkg.bin === 'string'
        ? { [basename(spec.npmPackage)]: pkg.bin } : pkg.bin || {}
      for (const binary of spec.binaries) {
        const name = binary.replace(/\.(exe|cmd|bat)$/i, '')
        const entry = bins[name]
        if (typeof entry !== 'string') continue
        const target = resolve(pkgDir, entry)
        if (!within(pkgDir, target) || !file(target) || !within(dir, realpathSync(target))) continue
        const command = join(dir, process.platform === 'win32' ? name + '.cmd' : 'bin/' + name)
        if (file(command) && within(dir, realpathSync(command))) return command
      }
    } else if (spec.pipPackage) {
      const names = spec.binaries.map((name) => name.replace(/\.(exe|cmd|bat)$/i, '') + (process.platform === 'win32' ? '.exe' : ''))
      const command = findFile(names, [join(dir, 'bin')])
      if (command && within(dir, realpathSync(command))) return command
    }
  } catch { /* Invalid or incomplete installs are not launchable. */ }
  return null
}

export function cliCapabilities(spec: EngineSpec): NonNullable<ProviderInfo['cli']> {
  try {
    const managed = ownedInstallation(spec)
    if (!managed && existsSync(installationDir(spec.id))) {
      return { install: false, uninstall: false, managed: false, reason: 'CLI directory is not ownership-proven; pqTERM will not adopt or delete it.' }
    }
    if (!managed) {
      const external = externalCommand(spec)
      if (external) return { install: false, uninstall: false, managed: false, reason: `External installation is protected: ${external}. Manage it with its original installer.` }
    }
    let reason: string | undefined
    if (spec.id === 'shell' || spec.id === 'cmd') reason = 'System shells are managed by Windows, not pqTERM.'
    else if (!spec.npmPackage && !spec.pipPackage) reason = 'No verified isolated installation recipe. Install with the official vendor installer; pqTERM cannot safely uninstall external files.'
    else if (spec.npmPackage && !npmRuntime()) reason = 'Node.js and npm-cli.js are required. Install Node.js with npm, then refresh.'
    else if (spec.pipPackage && !uvCommand()) reason = 'uv is required for an isolated Python CLI installation. Install uv, then refresh.'
    return { install: !reason, uninstall: managed, managed, ...(reason ? { reason } : {}) }
  } catch (error) {
    return { install: false, uninstall: false, managed: false, reason: error instanceof Error ? error.message : String(error) }
  }
}


async function run(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, append: (text: string) => void): Promise<void> {
  append(`$ ${JSON.stringify([file, ...args])}\n`)
  const child = spawn(file, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk: Buffer) => append(chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => append(chunk.toString()))
  const [code, signal] = await once(child, 'close')
  if (code !== 0) throw new Error(`Installer exited with ${signal || `code ${code}`}.`)
}

export function engineBusy(): boolean { return busy }

export async function operateEngine(id: EngineId, action: EngineOperation): Promise<EngineResult> {
  if (busy || !acquireLock()) {
    return { ok: false, message: 'Another CLI operation is in progress (also in other pqTERM editions). Wait for it to finish.', log: '' }
  }
  busy = true
  let log = ''
  const append = (text: string): void => { log += text }
  try {
    const spec = ENGINE_SPECS.find((s) => s.id === id)
    if (!spec || (action !== 'install' && action !== 'uninstall')) throw new Error('Unknown CLI or operation.')
    const capability = cliCapabilities(spec)
    if (!capability[action]) throw new Error(capability.reason || 'Not a pqTERM-owned installation; nothing removed.')
    const dir = installationDir(id)
    if (action === 'uninstall') {
      if (!ownedInstallation(spec)) throw new Error('Ownership verification failed; nothing removed.')
      append(`Removing owned CLI directory only: ${dir}\n`)
      // Keep the ownership marker until all payload is gone, including on a partial failure.
      for (const name of readdirSync(dir)) {
        if (name !== OWNER) rmSync(join(dir, name), { recursive: true })
      }
      const marker = readFileSync(join(dir, OWNER), 'utf8')
      unlinkSync(join(dir, OWNER))
      try { rmdirSync(dir) } catch (error) {
        if (existsSync(dir)) writeFileSync(join(dir, OWNER), marker, { flag: 'wx' })
        throw error
      }
      if (existsSync(dir)) throw new Error('CLI directory still exists after removal.')
      return { ok: true, message: `${spec.name} removed. Home, authentication and configuration files were preserved.`, log }
    }

    const packageName = spec.npmPackage || spec.pipPackage!
    if (!(spec.npmPackage ? /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i : /^[a-z0-9][a-z0-9._-]*$/i).test(packageName)) {
      throw new Error('Invalid registry package name; installation refused.')
    }
    const npm = spec.npmPackage ? npmRuntime() : null
    const uv = spec.pipPackage ? uvCommand() : null
    if (!npm && !uv) throw new Error('Required package manager is no longer available.')
    safePath(dir)
    if (!existsSync(dir)) {
      mkdirSync(rootDir(), { recursive: true })
      safePath(rootDir())
      mkdirSync(dir)
      try {
        writeFileSync(join(dir, OWNER), JSON.stringify({ owner: 'pqTERM', id, packageName }), { flag: 'wx' })
      } catch (error) {
        // Remove only our still-empty directory; never recursively remove an unmarked tree.
        rmdirSync(dir)
        throw error
      }
    }
    if (!ownedInstallation(spec)) throw new Error('Ownership verification failed; installation refused.')
    // Existing package directories must not redirect an update outside our owned prefix.
    const pending = [dir]
    while (pending.length) {
      const parent = pending.pop()!
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        const path = join(parent, entry.name)
        if (entry.isSymbolicLink()) {
          if (!within(dir, realpathSync(path))) throw new Error(`CLI payload link leaves the managed directory: ${path}`)
        } else if (entry.isDirectory()) pending.push(path)
      }
    }
    append(`Managed installation: ${dir}\nPackage: ${packageName}\n`)
    if (npm) {
      const env = { ...process.env }
      const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH'
      env[pathKey] = dirname(npm.node) + delimiter + (env[pathKey] || '')
      await run(npm.node, [npm.cli, 'install', '--global', '--prefix', dir, '--cache', join(dir, 'cache'), '--no-audit', '--no-fund', packageName + '@latest'], dir, env, append)
    } else {
      await run(uv!, ['tool', 'install', '--upgrade', packageName], dir, {
        ...process.env,
        UV_TOOL_DIR: join(dir, 'tools'),
        UV_TOOL_BIN_DIR: join(dir, 'bin'),
        UV_CACHE_DIR: join(dir, 'cache'),
        UV_PYTHON_INSTALL_DIR: join(dir, 'python')
      }, append)
    }
    const command = managedCommand(id)
    if (!command) throw new Error('Installer finished, but no valid CLI executable was found. The owned directory is retained for retry or uninstall.')
    append(`Verified CLI: ${command}\n`)
    return { ok: true, message: `${spec.name} installed in pqTERM's managed directory.`, log }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    append(`Error: ${message}\n`)
    const command = managedCommand(id)
    append(command ? `CLI still available: ${command}\n` : 'No valid managed CLI executable detected.\n')
    return { ok: false, message, log }
  } finally {
    busy = false
    releaseLock()
  }
}
