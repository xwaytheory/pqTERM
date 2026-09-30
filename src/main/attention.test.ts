import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripControls, visibleLines, isQuestion } from './attention.ts'

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

test('an empty input box is NOT a question — a busy TUI looks exactly the same', () => {
  // opencode mid-task, 2026-09-30: the TUI keeps an empty prompt above the
  // status bar while it streams output. Reading that as "turn finished" toasted
  // the user during normal work, so the rule is gone.
  assert.equal(isQuestion(visibleLines('streaming…\n\n│\n│ ❯ │\n│\nBuild auto · zen')), false)
  assert.equal(isQuestion(visibleLines('Answer ready\n│ ❯ │')), false)
})
