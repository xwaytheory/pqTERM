import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanOscTitle, isCliBrandOnly, scanOscTitle, stripCliPrefix } from './osc-title.ts'

test('scanOscTitle picks the last complete title from a single chunk', () => {
  const [title, keep] = scanOscTitle('\x1b]0;opencode: fix the grid\x07')
  assert.equal(title, 'opencode: fix the grid')
  assert.equal(keep, '')
})

test('scanOscTitle supports BEL and ESC\\ terminators and Pc 0/1/2', () => {
  assert.equal(scanOscTitle('\x1b]0;a\x07')[0], 'a')
  assert.equal(scanOscTitle('\x1b]1;b\x1b\\')[0], 'b')
  assert.equal(scanOscTitle('\x1b]2;c\x1b\\')[0], 'c')
})

test('scanOscTitle keeps styled segments of the title (inline SGR)', () => {
  const [title, keep] = scanOscTitle('\x1b]0;π Dodawanie cmd.exe do SPAWN ENGINE jak \x1b[2mpowershell\x1b[0m\x07')
  assert.equal(title, 'π Dodawanie cmd.exe do SPAWN ENGINE jak \x1b[2mpowershell\x1b[0m')
  assert.equal(keep, '')
  assert.equal(cleanOscTitle(title), 'π Dodawanie cmd.exe do SPAWN ENGINE jak powershell')
})

test('scanOscTitle keeps only the most recent OSC title', () => {
  const [title, keep] = scanOscTitle('prefix \x1b]0;one\x07 middle \x1b]0;two\x07 suffix')
  assert.equal(title, 'two')
  assert.equal(keep, '')
})

test('scanOscTitle carries a split OSC tail across chunks', () => {
  const [t1, keep1] = scanOscTitle('hello \x1b]0;omp: retry')
  assert.equal(t1, '')
  assert.equal(keep1, '\x1b]0;omp: retry')
  const [t2, keep2] = scanOscTitle(keep1 + ' #42\x07 tail')
  assert.equal(t2, 'omp: retry #42')
  assert.equal(keep2, '')
})

test('scanOscTitle resets when the tail is a complete non-OSC fragment', () => {
  const [title, keep] = scanOscTitle('\x1b]0;done\x07plain text')
  assert.equal(title, 'done')
  assert.equal(keep, '')
})

test('scanOscTitle ignores irrelevant output', () => {
  const [title, keep] = scanOscTitle('just some output\nlines 123')
  assert.equal(title, '')
  assert.equal(keep, '')
})

test('scanOscTitle drops a pathologically long unterminated OSC', () => {
  const [title, keep] = scanOscTitle('\x1b]0;' + 'x'.repeat(2000))
  assert.equal(title, '')
  assert.equal(keep, '')
})

test('cleanOscTitle strips ANSI SGR inside the payload', () => {
  assert.equal(cleanOscTitle('a\x1b[31;1mb\x1b[0mc'), 'abc')
})

test('cleanOscTitle normalizes whitespace and trims', () => {
  assert.equal(cleanOscTitle('  omp:   error   '), 'omp: error')
})

test('cleanOscTitle clips very long titles to 120 chars', () => {
  const long = 't'.repeat(150)
  assert.equal(cleanOscTitle(long), 't'.repeat(120))
})

test('cleanOscTitle strips trailing ellipsis the CLI appends', () => {
  assert.equal(cleanOscTitle('Dodanie freebuff i Kimi Code do Spawn…'), 'Dodanie freebuff i Kimi Code do Spawn')
  assert.equal(cleanOscTitle('tytuł…'), 'tytuł')
  assert.equal(cleanOscTitle('nie skracam… w środku'), 'nie skracam… w środku')
})

const omp = { id: 'omp', name: 'Omp', mark: 'Om' }
const opencode = { id: 'opencode', name: 'OpenCode', mark: 'Oc' }

test('stripCliPrefix removes glyph mark with separator', () => {
  assert.equal(stripCliPrefix('π > Brak cmd.exe w wyborze CLI', omp), 'Brak cmd.exe w wyborze CLI')
})

test('stripCliPrefix removes id/name/mark with separator', () => {
  assert.equal(stripCliPrefix('Omp: fixing the grid', omp), 'fixing the grid')
  assert.equal(stripCliPrefix('omp | retry', omp), 'retry')
  assert.equal(stripCliPrefix('Om – resize panes', omp), 'resize panes')
  assert.equal(stripCliPrefix('OpenCode > schema', opencode), 'schema')
})

test('stripCliPrefix matches brand token case-insensitively', () => {
  assert.equal(stripCliPrefix('OMP: fix me', omp), 'fix me')
  assert.equal(stripCliPrefix('opencode: prompt', opencode), 'prompt')
})

test('stripCliPrefix removes glyph followed by plain space', () => {
  assert.equal(stripCliPrefix('π session title', omp), 'session title')
})

test('stripCliPrefix keeps titles that start with the engine word', () => {
  assert.equal(stripCliPrefix('Omp is a nice CLI', omp), 'Omp is a nice CLI')
  assert.equal(stripCliPrefix('omp server', omp), 'omp server')
})

test('stripCliPrefix keeps unrelated titles intact', () => {
  assert.equal(stripCliPrefix('fix the grid', omp), 'fix the grid')
  assert.equal(stripCliPrefix('', omp), '')
  assert.equal(stripCliPrefix('   ', omp), '')
})

test('isCliBrandOnly detects a CLI reset to bare brand', () => {
  assert.equal(isCliBrandOnly('π', omp), true)
  assert.equal(isCliBrandOnly('Omp:', omp), true)
  assert.equal(isCliBrandOnly('omp', omp), true)
  assert.equal(isCliBrandOnly('', omp), true)
  assert.equal(isCliBrandOnly('π > Brak cmd.exe', omp), false)
  assert.equal(isCliBrandOnly('Omp: fixing the grid', omp), false)
})