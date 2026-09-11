import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, relative, sep } from 'path'
import type { BoardNote, BoardPane, BoardSnapshot, EngineId } from '../shared/types'

const FILE_RE =
  /(?:[A-Za-z]:[\\/])?(?:[\w.+-]+[\\/])+[\w.+-]+\.[A-Za-z0-9]{1,8}|[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|cs|java|kt|md|json|toml|yml|yaml|css|html|vue|php|rb|sql|xml)/g

const SKIP = /node_modules|\.git\\|\/\.git\/|\.pq\\|dist\\|out\\|release\\/i

function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
}

function gitPorcelain(cwd: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['status', '--porcelain', '-uall'],
      { cwd, windowsHide: true, timeout: 4000, maxBuffer: 200000 },
      (err, stdout) => {
        if (err) return resolve([])
        resolve(
          stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 40)
        )
      }
    )
  })
}

interface LivePane {
  paneId: string
  engine: EngineId
  title: string
  alive: boolean
  files: Map<string, number>
  tail: string
}

export class BoardHub {
  private cwd = ''
  private panes = new Map<string, LivePane>()
  private timer: ReturnType<typeof setInterval> | null = null
  private last: BoardSnapshot | null = null
  private onChange: ((s: BoardSnapshot) => void) | null = null

  setListener(fn: (s: BoardSnapshot) => void): void {
    this.onChange = fn
  }

  attach(cwd: string): void {
    this.cwd = cwd
    this.ensureDir()
    this.writeInstructions()
    this.ensureGitignore()
    this.patchAgentsFile()
    this.flush()
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.flush()
      }, 2500)
    }
  }

  detach(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.panes.clear()
    this.cwd = ''
    this.last = null
  }

  paneStart(paneId: string, engine: EngineId, title: string): void {
    this.panes.set(paneId, {
      paneId,
      engine,
      title,
      alive: true,
      files: new Map(),
      tail: ''
    })
    void this.flush()
  }

  paneEnd(paneId: string): void {
    const p = this.panes.get(paneId)
    if (p) p.alive = false
    void this.flush()
  }

  onOutput(paneId: string, chunk: string): void {
    const p = this.panes.get(paneId)
    if (!p || !this.cwd) return
    const text = stripAnsi(chunk)
    p.tail = (p.tail + text).slice(-8000)
    const now = Date.now()
    const matches = text.match(FILE_RE) ?? []
    for (const raw of matches) {
      if (SKIP.test(raw)) continue
      const rel = this.normalize(raw)
      if (!rel) continue
      p.files.set(rel, now)
    }
    if (p.files.size > 24) {
      const ordered = [...p.files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16)
      p.files = new Map(ordered)
    }
  }

  snapshot(): BoardSnapshot | null {
    return this.last
  }

  boardPath(): string {
    return this.cwd ? join(this.cwd, '.pq', 'BOARD.md') : ''
  }

  extraEnv(paneId: string): NodeJS.ProcessEnv {
    if (!this.cwd) return {}
    return {
      PQ: '1',
      PQ_WORKSPACE: this.cwd,
      PQ_PANE_ID: paneId,
      PQ_BOARD: join(this.cwd, '.pq', 'BOARD.md'),
      PQ_INSTRUCTIONS: join(this.cwd, '.pq', 'INSTRUCTIONS.md')
    }
  }

  private dir(): string {
    return join(this.cwd, '.pq')
  }

  private ensureDir(): void {
    if (!this.cwd) return
    mkdirSync(this.dir(), { recursive: true })
  }

  private normalize(raw: string): string | null {
    let p = raw.replace(/\//g, sep)
    if (/^[A-Za-z]:[\\/]/.test(p)) {
      try {
        p = relative(this.cwd, p)
      } catch {
        return null
      }
    }
    p = p.replace(/^[\\/]+/, '')
    if (!p || p.startsWith('..') || SKIP.test(p)) return null
    if (p.split(sep).length > 10) return null
    return p
  }

  private notes(panes: BoardPane[]): BoardNote[] {
    const notes: BoardNote[] = []
    const live = panes.filter((p) => p.alive && p.files.length)
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i]
        const b = live[j]
        const share = a.files.filter((f) => b.files.includes(f))
        if (share.length) {
          notes.push({
            relation: 'overlap',
            engines: [a.engine, b.engine],
            detail: `${a.engine} i ${b.engine} ruszają te same pliki: ${share.slice(0, 6).join(', ')}. Jeden implementuje, drugi czeka albo recenzuje — nie nadpisujcie się.`
          })
          continue
        }
        const topsA = new Set(a.files.map((f) => f.split(/[\\/]/)[0]))
        const topsB = new Set(b.files.map((f) => f.split(/[\\/]/)[0]))
        const topShare = [...topsA].filter((t) => topsB.has(t))
        if (topShare.length) {
          notes.push({
            relation: 'related',
            engines: [a.engine, b.engine],
            detail: `${a.engine} i ${b.engine} pracują w ${topShare.join(', ')} — czytajcie nawzajem BOARD i dzielcie pliki, albo jeden robi review.`
          })
        } else {
          notes.push({
            relation: 'independent',
            engines: [a.engine, b.engine],
            detail: `${a.engine} i ${b.engine} nie nachodzą na te same ścieżki — mogą iść równolegle.`
          })
        }
      }
    }
    if (!live.length && panes.filter((p) => p.alive).length > 1) {
      notes.push({
        relation: 'independent',
        engines: panes.filter((p) => p.alive).map((p) => p.engine),
        detail: 'Kilka pane’ów live, jeszcze bez claimów na pliki — wolno startować, ale najpierw przeczytaj BOARD.'
      })
    }
    return notes.slice(0, 12)
  }

  private async flush(): Promise<void> {
    if (!this.cwd) return
    this.ensureDir()
    const now = Date.now()
    const stale = 120000
    const panes: BoardPane[] = [...this.panes.values()].map((p) => ({
      paneId: p.paneId,
      engine: p.engine,
      title: p.title,
      alive: p.alive,
      files: [...p.files.entries()]
        .filter(([, t]) => now - t < stale)
        .sort((a, b) => b[1] - a[1])
        .map(([f]) => f)
        .slice(0, 10)
    }))
    const git = await gitPorcelain(this.cwd)
    const notes = this.notes(panes)
    const snap: BoardSnapshot = {
      cwd: this.cwd,
      boardPath: this.boardPath(),
      updatedAt: now,
      panes,
      git,
      notes
    }
    this.last = snap
    this.writeMarkdown(snap)
    this.writeJson(snap)
    this.writeTails()
    this.onChange?.(snap)
  }

  private writeMarkdown(s: BoardSnapshot): void {
    const live = s.panes.filter((p) => p.alive)
    const lines: string[] = [
      '# pq board',
      '',
      `workspace: \`${s.cwd}\``,
      `updated: ${new Date(s.updatedAt).toISOString()}`,
      '',
      'Zasada: zanim edytujesz plik, przeczytaj tę tablicę. Jeśli inny pane trzyma ten plik — czekaj, recenzuj, albo weź inny kawałek. Jeśli notes mówią independent — działaj swobodnie.',
      '',
      '## panes'
    ]
    if (!live.length) lines.push('_brak żywych agentów_')
    for (const p of live) {
      lines.push(
        `- **${p.engine}** \`${p.paneId.slice(0, 8)}\` files: ${p.files.length ? p.files.map((f) => '`' + f + '`').join(', ') : '(jeszcze nic)'}`
      )
    }
    lines.push('', '## git')
    if (s.git.length) lines.push(...s.git.map((g) => `- \`${g}\``))
    else lines.push('_clean / nie git_')
    lines.push('', '## notes')
    if (s.notes.length) {
      for (const n of s.notes) {
        lines.push(`- **${n.relation}** · ${n.detail}`)
      }
    } else lines.push('_brak_')
    lines.push(
      '',
      '## jak pomagać',
      '- overlap → jeden kodzi, drugi czyta diff / testy, nie zapisuje tych samych plików.',
      '- related → podzielcie pliki w tym katalogu na głos (dopisz claim tutaj poprzez pracę; pq sam wyłapie ścieżki z TUI).',
      '- independent → pełny YOLO na swoim wycinku.',
      `- logi ogonów: \`.pq/panes/<id>.log\``,
      ''
    )
    writeFileSync(this.boardPath(), lines.join('\n'), 'utf8')
  }

  private writeJson(s: BoardSnapshot): void {
    writeFileSync(join(this.dir(), 'board.json'), JSON.stringify(s, null, 2), 'utf8')
  }

  private writeTails(): void {
    const pdir = join(this.dir(), 'panes')
    mkdirSync(pdir, { recursive: true })
    for (const p of this.panes.values()) {
      const name = `${p.engine}-${p.paneId.slice(0, 8)}.log`
      writeFileSync(join(pdir, name), p.tail.slice(-6000), 'utf8')
    }
  }

  private writeInstructions(): void {
    const body = `pq — koordynacja agentów w jednym workspace.

Jesteś jednym z kilku CLI w siatce pq (Grok, OpenCode, Omp, Claude, …).
Nie jesteś sam.

OBOWIĄZKOWO na starcie i przed większą edycją:
1. Przeczytaj \`.pq/BOARD.md\` (albo \`.pq/board.json\`).
2. Sprawdź sekcję notes: overlap / related / independent.
3. Jeśli overlap na Twoich plikach — NIE nadpisuj. Albo poczekaj, albo zrób review, albo weź inne pliki.
4. Jeśli independent — pracuj dalej, nie blokuj innych.
5. Ogon wyjścia innych pane’ów: \`.pq/panes/*.log\` (wgląd, nie zgadywanie).

Zmienne: PQ_BOARD, PQ_PANE_ID, PQ_WORKSPACE, PQ_INSTRUCTIONS.
`
    writeFileSync(join(this.dir(), 'INSTRUCTIONS.md'), body, 'utf8')
  }

  private ensureGitignore(): void {
    const gi = join(this.cwd, '.gitignore')
    const line = '.pq/'
    try {
      const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
      if (cur.split(/\r?\n/).some((l) => l.trim() === line)) return
      writeFileSync(gi, `${cur}${cur.endsWith('\n') || !cur ? '' : '\n'}# pq\n${line}\n`, 'utf8')
    } catch {
      /* ignore */
    }
  }

  private patchAgentsFile(): void {
    const marker = '<!-- pq:board -->'
    const end = '<!-- /pq:board -->'
    const block = `${marker}
## pq
To repo jest otwarte w siatce pq (kilka agentów naraz).
Zanim edytujesz pliki: przeczytaj \`.pq/BOARD.md\`.
Overlap → nie zapisuj tych samych plików co inny pane. Related → podzielcie katalog. Independent → działaj.
${end}
`
    const target = join(this.cwd, 'AGENTS.md')
    try {
      if (!existsSync(target)) {
        writeFileSync(target, block, 'utf8')
        return
      }
      const cur = readFileSync(target, 'utf8')
      if (cur.includes(marker)) {
        const next = cur.replace(new RegExp(`${marker}[\\s\\S]*?${end}`, 'm'), block.trim())
        if (next !== cur) writeFileSync(target, next, 'utf8')
        return
      }
      writeFileSync(target, `${cur.trimEnd()}\n\n${block}`, 'utf8')
    } catch {
      /* ignore */
    }
  }
}
