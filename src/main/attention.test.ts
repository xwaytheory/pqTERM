import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripControls, visibleLines, isQuestion, isIdleInputBox } from './attention.ts'

// Verbatim shapes of the approval prompts the CLIs actually print.
const SAMPLES: [string, string][] = [
  ['claude', 'Do you want to proceed?\n❯ 1. Yes\n  2. No, tell Claude what to do differently\nEsc to cancel'],
  ['claude-tools', '╭─────────────────────────────────────╮\n│ Do you want to run this command? │\n│ npm test                          │\n╰─────────────────────────────────────╯\n❯ 1. Yes\n  2. No\n'],
  ['codex', 'Allow command?\n│ python build.py\n└─ yes / no'],
  ['codex-apply-patch', 'Would you like to apply this patch?\n1. Yes, apply\n2. No'],
  ['gemini', 'Allow execution of: rm -rf build ? [Y/n]'],
  ['qwen', 'Do you want to proceed? (y/n)'],
  ['copilot', 'Authorize this command: [y/N]'],
  ['opencode', 'permission.asked\n│ Do you want to run `rm -rf` ?\n│ ❯ 1. Yes\n│   2. No'],
  ['omp', 'omp wants to run Bash'],
  ['hermes', 'Hermes needs your permission to use sudo']
]

for (const [cli, text] of SAMPLES) {
  test(`${cli}: a blocked prompt counts as a question`, () => {
    assert.equal(isQuestion(visibleLines(text)), true, text)
  })
}

const NOT_QUESTIONS: [string, string][] = [
  ['answer text', 'I picked BFS over DFS because the graph is unweighted. Why?\n\nThe answer is in src/grid.ts.'],
  ['spinner', '⠋ Thinking… 12s'],
  ['tool output', 'running tests\n15 passing\nDone in 4s'],
  ['shell prompt', 'PS C:\\Users\\pq> '],
  ['diff', '+  const x = 1\n-  const y = 2']
]

for (const [name, text] of NOT_QUESTIONS) {
  test(`${name}: not a question`, () => {
    assert.equal(isQuestion(visibleLines(text)), false, text)
  })
}

test('controls and box drawing are stripped so the tail reads like the screen', () => {
  assert.equal(stripControls('\x1b[2J\x1b[32mHello\x1b[0m'), 'Hello')
  assert.equal(stripControls('\x1b]0;title\x07text'), ' text')
  assert.deepEqual(visibleLines('a\nb\n│ > │\n'), ['a', 'b', '>'])
})

test('an empty input box is the finished-turn signal, a filled one is not', () => {
  assert.equal(isIdleInputBox(visibleLines('Answer ready\n│\n│ ❯ │\n│\n')), true)
  assert.equal(isIdleInputBox(visibleLines('Answer ready\n│ >  jestem w trakcie pisania\n')), false)
  assert.equal(isIdleInputBox(visibleLines('Answer ready\nstill printing the patch\n')), false)
})

test('a long answer with a trailing prompt is not read as an idle box', () => {
  // more than two visible lines: the tail is content, not an input line
  assert.equal(isIdleInputBox(visibleLines('one\ntwo\nthree\nfour\n> ')), false)
})
