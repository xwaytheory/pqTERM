import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The Rust track declares its IPC surface in two places: the `#[tauri::command]` functions in
 * cmd.rs and the `generate_handler![]` list in lib.rs. Missing the second one does not fail the
 * build — Tauri answers "command not found" at runtime instead — so the gap is invisible until a
 * renderer call is exercised by hand. These checks keep both sides honest without a Tauri build.
 */
const here = dirname(fileURLToPath(import.meta.url))
const cmdSrc = readFileSync(join(here, 'src', 'cmd.rs'), 'utf8')
const libSrc = readFileSync(join(here, 'src', 'lib.rs'), 'utf8')

/** Every function carrying a `#[tauri::command]` attribute, in source order. */
function declaredCommands(src: string): string[] {
  const names: string[] = []
  const marker = /#\[tauri::command\]/g
  let m: RegExpExecArray | null
  while ((m = marker.exec(src))) {
    const fn = src.slice(m.index).match(/\bfn\s+([A-Za-z0-9_]+)\s*[(<]/)
    if (fn) names.push(fn[1])
  }
  return names
}

/** Entries of the `generate_handler![]` macro, comments stripped. */
function registeredEntries(src: string): string[] {
  const block = /generate_handler!\[([\s\S]*?)\]/.exec(src)
  assert.ok(block, 'lib.rs: generate_handler![] not found — did the invoke_handler move?')
  return block[1]
    .replace(/\/\/[^\n]*/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Parameter names of one command, split on top-level commas. */
function paramNames(src: string, name: string): string[] {
  const sig = new RegExp(
    `fn\\s+${name}\\s*(?:\\(|<[^>]*>\\s*\\()([\\s\\S]*?)\\)\\s*(?:->|\\{)`
  ).exec(src)
  assert.ok(sig, `cmd.rs: signature of \`${name}\` not found`)
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of sig[1]) {
    if ('<([{'.includes(ch)) depth++
    if ('>)]}'.includes(ch)) depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split(':')[0].trim())
}

const declared = declaredCommands(cmdSrc)
const registered = registeredEntries(libSrc)
const fromMod = registered.filter((e) => e.startsWith('cmd::')).map((e) => e.slice(5))

test('cmd.rs declares the whole command surface', () => {
  // Guards the regexes above: if the attribute or fn syntax changes, the assertions below would
  // keep passing over an empty list.
  assert.ok(declared.length >= 40, `only ${declared.length} commands parsed out of cmd.rs`)
  assert.equal(new Set(declared).size, declared.length, 'duplicate #[tauri::command] name')
})

test('every cmd.rs command is registered in lib.rs invoke_handler', () => {
  const missing = declared.filter((n) => !fromMod.includes(n))
  assert.deepEqual(
    missing,
    [],
    `declared but never registered (Tauri answers "command not found"): ${missing.join(', ')}`
  )
})

test('every registered handler points at a real command', () => {
  const unknown = fromMod.filter((n) => !declared.includes(n))
  assert.deepEqual(unknown, [], `registered but not declared in cmd.rs: ${unknown.join(', ')}`)
  assert.equal(new Set(registered).size, registered.length, 'duplicate entry in generate_handler!')
})

test('local handlers (ping) are #[tauri::command] too', () => {
  const local = registered.filter((e) => !e.startsWith('cmd::'))
  const localDeclared = declaredCommands(libSrc)
  for (const name of local) {
    assert.ok(localDeclared.includes(name), `lib.rs handler \`${name}\` has no #[tauri::command]`)
  }
})

test('command parameters stay snake_case', () => {
  // Tauri maps the camelCase keys a JS caller passes onto snake_case Rust params. A camelCase
  // parameter could never be filled from JS, and `invoke` would fail on a missing argument.
  const bad: string[] = []
  for (const name of declared) {
    for (const p of paramNames(cmdSrc, name)) {
      if (!/^_?[a-z][a-z0-9_]*$/.test(p)) bad.push(`${name}(${p})`)
    }
  }
  assert.deepEqual(bad, [], `non snake_case parameter names: ${bad.join(', ')}`)
})

test('payload parameters resolve to fields declared next to the command', () => {
  // `pty_spawn(state, payload: PtySpawnPayload)` and friends: the struct is the actual contract,
  // so it has to live in cmd.rs rather than be referenced from somewhere the test cannot see.
  const payloads = [...cmdSrc.matchAll(/struct\s+(PtySpawnPayload|PtyResizePayload|WorkspaceSpawnPayload)\b/g)]
  assert.equal(payloads.length, 3, 'expected the 3 pty/workspace payload structs in cmd.rs')
})
