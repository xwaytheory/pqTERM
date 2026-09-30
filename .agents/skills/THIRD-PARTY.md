# Third-party: vendored skills

Everything under `.agents/skills/` is an unmodified vendored copy installed with the `skills` CLI
(`npx skills add <repo> --yes`); `skills-lock.json` pins the SHA-256 of every skill, so
`npx skills update` is the only supported way to refresh them. Re-install with
`npx skills experimental_install` to restore from the lock file.

| Skills | Source | License | Installed with |
|---|---|---|---|
| `ponytail`, `ponytail-*` | https://github.com/DietrichGebert/ponytail | MIT | `npx skills add dietrichgebert/ponytail --yes` |
| `i-have-adhd` | https://github.com/ayghri/i-have-adhd | MIT | `npx skills add ayghri/i-have-adhd --skill i-have-adhd --agent codex --yes` |
| `brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `using-git-worktrees`, `executing-plans`, `subagent-driven-development`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`, `dispatching-parallel-agents`, `finishing-a-development-branch`, `diagnosing-superpowers`, `writing-skills`, `using-superpowers` | https://github.com/obra/superpowers | MIT | `npx skills add obra/superpowers --yes` |
| `ui-ux-pro-max`, `ui-styling`, `design`, `design-system`, `brand`, `slides`, `banner-design` | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | MIT (`ui-styling` bundles OFL fonts + Apache-2.0 tooling, both files shipped) | `npx skills add nextlevelbuilder/ui-ux-pro-max-skill --yes` |
| `graphify` | https://github.com/Graphify-Labs/graphify | Apache-2.0 | `npx skills add Graphify-Labs/graphify --yes` |

Skills run with the agent's full permissions. `graphify` ships a Python package and writes
`graphify-out/` into the project; that directory is gitignored. The design/visual skills
(`brand`, `design`, `slides`, `banner-design`) invoke external image/model APIs when the skill is
actually used — nothing runs on install.

## ponytail

The skill files under `.agents/skills/ponytail*/` are vendored, unmodified copies installed with
`npx skills add dietrichgebert/ponytail --yes` (see `skills-lock.json` for the pinned hashes).

- Source: https://github.com/DietrichGebert/ponytail
- Copyright (c) 2026 DietrichGebert
- License: MIT

```
MIT License

Copyright (c) 2026 DietrichGebert

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`AGENTS.md` ("Ponytail (minimalism) — active by default") is this repo's own wording, not a copy of
the upstream ruleset; the ruleset itself stays in the vendored `SKILL.md` files.

## i-have-adhd

`.agents/skills/i-have-adhd/` is an unmodified vendored skill installed with
`npx skills add ayghri/i-have-adhd --skill i-have-adhd --agent codex --yes`.
Source and pinned hash are recorded in `skills-lock.json`.
Source: https://github.com/ayghri/i-have-adhd

```
MIT License

Copyright (c) 2026 Ayoub Ghriss

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
