# pqTERM

Siatka terminali dla agentów AI na Windows. Workspace'y po lewej, 1–9 żywych TUI po prawej.

**Wersja: 1.2.0** (edycje: `pqTERM-pr` produkcja, `pqTERM-dev` testy)

Na razie **prywatne**. Publicznie wyjdzie dopiero gdy zdecydujesz.

---

---

## Rust migration (WIP)

Trwa migracja Electron → Rust (**Phase 1: plan + scaffold**). Electron nadal jest produkcją.

- Plan: [docs/MIGRATION-RUST.md](docs/MIGRATION-RUST.md)
- Workspace: crates/ (pq-work, pq-voice, pq-core)
- STT map (honest): **CURRENT Electron** = `Xenova/whisper-tiny` (`voiceCommander.ts`); **INTENT desktop Rust / pq-voice** = Whisper Large v3 (`openai/whisper-large-v3`, PL) — not a runtime lock; **Android** = system `SpeechRecognizer` only (no on-device Whisper)
- Night backlog (installer MSI/EXE, logo, DnD, gauntlet): [docs/BACKLOG-NIGHT.md](docs/BACKLOG-NIGHT.md) · [docs/LOGOS-INVENTORY.md](docs/LOGOS-INVENTORY.md) · [docs/workbench.md](docs/workbench.md)
- Build szkicu:

`at
cd crates
cargo build
`

Nie usuwaj / nie łam src/, package.json, host/ — Phase 1 ich nie zastępuje.

---

## Nowy komputer (instalacja od zera)

1. Zainstaluj [Node.js LTS](https://nodejs.org/) i [Git](https://git-scm.com/).
2. Zaloguj się do GitHuba (`gh auth login` albo Git Credential Manager przy `git clone`).
3. Sklonuj repo:

```bat
git clone https://github.com/xwaytheory/pq.git
cd pq
npm install
npm run rebuild
npm run dev
```

4. Zaloguj się w aplikacji (Google lub lokalnie). Workspace'y i logowanie **nie** jadą w gicie — są w `%AppData%\pqTERM-dev`. Na nowym PC logujesz się od nowa i wskazujesz foldery projektów.

---

## Dwa środowiska

| | **pqTERM-dev** | **pqTERM-pr** |
|---|---|---|
| start | `npm run dev` | `START-pr.cmd` (lub skrót na pulpicie) |
| plik | `START-dev.cmd` | `START-pr.cmd` |
| dane | `%AppData%\pqTERM-dev` | `%AppData%\pqTERM-pr` |
| po co | łamiesz produkt | codziennie odpalasz agentów |

**W produkcji** (`pqTERM-pr`):
- `host/pqterm.exe` to skopiowany Electron podpisany rcedit jako "pqTERM"
- UI buduje się raz (`npm run build`), potem `START-pr.cmd` odpala bez serwera dev

Nie commituj z katalogu, z którego leci akurat `npm run dev` w tym samym drzewie co agenty — trzymaj **klon gita** jako cwd workspace'u.

---

## Struktura projektu

```
pq/
├── src/
│   ├── main/          # Electron main process (TypeScript)
│   │   ├── index.ts       # entry: okna, IPC, remote, sesje, board, usage
│   │   ├── auth.ts        # logowanie Google (AccountChooser + OAuth2 PKCE)
│   │   ├── engines.ts     # definicje agentów AI (binarki, modele, args)
│   │   ├── store.ts       # stan app: %AppData%/pq*/pq-state.json
│   │   ├── pty-manager.ts # node-pty: spawn/clear/write pane
│   │   ├── bridge.ts      # PaneBridge IPC — spawn/write/fill panes
│   │   ├── remote.ts      # WebSocket server (port 4747) — phone control
│   │   ├── resume.ts      # wznowienie sesji agenta (sessionHandle)
│   │   ├── board.ts       # .pq/board.json — koordynacja agentów w workspace
│   │   ├── usage.ts       # budżetowanie tokenów/okien resetu
│   │   ├── sync.ts        # EngineSync — postęp synchronizacji agentów
│   │   ├── providers.ts   # auto-detect CLI agentów + dopasowanie email
│   │   ├── resolve-launch.ts # rozwiązywanie komend launch
│   │   ├── trust.ts       # zaufane ścieżki/sygnatury
│   │   ├── host.ts        # re-export z electron
│   │   └── env.ts         # runningDev() / productName()
│   ├── renderer/      # React UI (xterm.js grid)
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── main.tsx
│   │       ├── components/
│   │       ├── lib/
│   │       ├── screens/
│   │       └── styles.css
│   ├── preload/       # contextBridge API
│   │   └── index.ts
│   ├── phone/         # web app dla telefonu (Vite)
│   │   └── index.html + src/
│   ├── shared/        # współdzielone typy TS
│   │   └── types.ts
│   └── android/       # Kotlin/APK (edge-to-edge, safe-area, mic permission)
├── scripts/
│   ├── pq.cjs         # dev/build/preview orchestrator
│   ├── rebuild.cjs    # electron-builder install-app-deps + stamp-host
│   ├── stamp-host.cjs # kopiuje electron dist → host/, rcedit → pqterm.exe
│   └── make-shortcuts.cjs # skróty .lnk na pulpicie (PowerShell)
├── host/              # ⭐ skompilowany Electron podpisany jako "pqTERM" (gitignore)
├── out/               # build output (gitignore)
├── resources/         # zasoby
├── .pq/               # board.json + BOARD.md (gitignore, per workspace)
├── package.json
├── pq.vite.config.ts  # renderer vite config
├── phone.vite.config.ts
├── tsconfig.json
├── START.cmd          # → START-dev.cmd
├── START-dev.cmd      # dev: npm install → rebuild → npm run dev
└── START-pr.cmd       # prod: npm install → rebuild → build → stamp-host → host/pqterm.exe
```

---

## Komendy npm

| Komenda | Opis |
|---|---|
| `npm run dev` | Tryb dev (vite watch + electron, dane w `%AppData%\pqTERM-dev`) |
| `npm run build` | Zbuduj renderer + phone do `out/` |
| `npm run preview` | Podgląd produkcji z dev serwerem |
| `npm run start` | Alias: `npm run preview` |
| `npm run rebuild` | `electron-builder install-app-deps` + `stamp-host` |
| `npm run stamp` | Tylko stamp-host (skopiuj electron → host/) |
| `npm run shortcuts` | Utwórz skróty na pulpicie (pqTERM-dev.lnk, pqTERM-pr.lnk) |
| `npm run dist` | Installery NSIS+MSI → `release/` (nadpisuje target; `build.win.target` zostaje `dir` dla stamp-host) |
| `npm run test:unit` | Testy jednostkowe (m.in. `quotePath` / DnD) |
| `npm postinstall` | Automatycznie po `npm install`: `rebuild` |

---

## Packaging (Windows)

- **Daily / portable:** `npm run stamp` / `START-pr.cmd` → `host/pqterm.exe` (`build.win.target: "dir"`).
- **Installers:** `npm run dist` → NSIS Setup + MSI in `release/` (`appId: com.pqterm.app`, stable MSI `upgradeCode`).
- Brand icons: `resources/brand/pq.ico`, `pq-256.png`, `pq-512.png` (not `pq.png`).
- Builds are **unsigned** — expect SmartScreen warnings until a signing cert is configured (`publisherName` placeholder in `package.json`; not a real cert).
- `npm run dist` smoke: run when convenient; **do not claim** NSIS/MSI exist until `release/` artifacts are present. Daily path remains `stamp` → `host/pqterm.exe`.

## Engines (agenty AI)

Aplikacja wykrywa automatycznie zainstalowane CLI agentów. Każdy engine ma: binarkę, domyślne args, kolory, modele.

| ID | Nazwa | Vendor | Binarka | Args |
|---|---|---|---|---|
| `grok` | Grok CLI | xAI | `grok` | `--always-approve --trust` |
| `omp` | Omp | oh-my-pi | `omp` | `--yolo` |
| `hermes` | Hermes | Nous | `hermes` | `--tui --yolo` |
| `opencode` | OpenCode | OpenCode | `opencode` | `--yolo` |
| `codex` | Codex | OpenAI | `codex` | `--yolo` |
| `claude` | Claude Code | Anthropic | `claude` | `--dangerously-skip-permissions` |
| `qwen` | Qwen Code | Alibaba | `qwen` | `--yolo` |
| `dsh` | DeepSeek Harness | DeepSeek | `dsh` | `--profile tui` |
| `gemini` | Gemini CLI | Google | `gemini` | `--yolo --skip-trust` |
| `crush` | Crush | Charmbracelet | `crush` | — |
| `aider` | Aider | Aider-AI | `aider` | `--yes` |
| `copilot` | Copilot CLI | GitHub | `copilot` | `--yolo` |
| `shell` | PowerShell | Windows | `pwsh` | `-NoLogo` |

**Modele**: większość engine'u obsłużym przez `--model <id>` (OpenRouter-compatible). Hermes ma własne (`hermes-default`, `hermes-large`).

---

## Logowanie

- **Google AccountChooser** (domyślnie, brak clientId) — modalne okno loguje przez `accounts.google.com/AccountChooser`
- **Google OAuth2 PKCE** (z `clientId` + opcjonalnie `clientSecret`) — redirect na `http://127.0.0.1:<port>/callback`
- **Local** — wpisanie ręcznie emaila (np. gmail)

Stan logowania + konfiguracja Google zapisane w `%AppData%\pq*\pq-state.json`.

---

## Remote (telefon)

- WebSocket server na porcie **4747** (lub skonfigurowanym)
- Phone: otwórz w przeglądarce `http://<IP-pc>:4747/` — wymaga PIN
- Tunel WAN: automatyczny **cloudflared** (pobierany z GitHub releases do `%AppData%\pq*\bin\cloudflared.exe`)
- Tailscale: jeśli zainstalowany, używa jego IP
- Stan: `%AppData%\pq*\remote.json` (token, pin, wanUrl, deviceId)

---

## Android

- Projekt w `android/` (Kotlin, Gradle)
- Budowanie: `cd android && gradlew assembleDebug`
- APK: `android/pq-debug.apk` (w repo, bo ma `!android/pq-debug.apk` w .gitignore)
- Edge-to-edge, safe-area insets, mic permission, retry screen, back=background

---

## Layouty (siatka pane)

| Layout | Panes | Grid |
|---|---|---|
| 1 | 1 | 1×1 |
| 2 | 2 | 2×1 |
| 3 | 3 | 3×1 |
| 4 | 4 | 2×2 |
| 6 | 6 | 3×2 |
| 9 | 9 | 3×3 |

Pane może być **zoomed** (rozciągnięty na całą siatkę, reszta w tle).

---

## Stan aplikacji (gdzie)

| Co | Gdzie |
|---|---|
| Stan app | `%AppData%\pq*\pq-state.json` |
| Logowanie Google | tam samo (google.clientId/clientSecret) |
| Remote | `%AppData%\pq*\remote.json` |
| Sesje PTY (logi) | `%AppData%\pq*\sessions\<workspaceId>\<paneId>.log` |
| Tunel cloudflared | `%AppData%\pq*\bin\cloudflared.exe` |
| Board koordynacji | `<workspace cwd>/.pq/board.json` + `BOARD.md` |

---

## Koordynacja agentów

W cwd workspace'u: `.pq/BOARD.md`. Agenty mają czytać tablicę zanim wejdą w te same pliki.

`BoardHub` śledzi:
- Które pliki otworzyli agenty
- Status pane (alive/dead)
- Git diff
- Relacje między agentami (independent/related/overlap)

---

## Build produkcji (release)

```bat
cd %USERPROFILE%\pq
npm install
npm run build
npm run stamp
:: host/pqterm.exe gotowy
START-pr.cmd
```

Albo jednym strzałem:
```bat
START-pr.cmd
```

**Uwaga**: `scripts/stamp-host.cjs` używa `rcedit` do podpisania `electron.exe` → `pqterm.exe` (zmiana ProductName, FileDescription, wersja 1.1.7). Wymaga `node_modules/rcedit/bin/rcedit-x64.exe`.

---

## Skróty pulpitu

```bat
npm run shortcuts
```

Tworzy na pulpicie:
- `pqTERM-dev.lnk` → `START-dev.cmd`
- `pqTERM-pr.lnk` → `host/pqterm.exe <root>`

---

## Technologie

- **Electron 33** (Node.js + Chromium)
- **React 18** + **TypeScript 5.7**
- **xterm.js** (terminal grid)
- **node-pty** (pseudoterminal)
- **ws** (WebSocket)
- **Vite 5** (renderer/phone build)
- **electron-vite** (main/preload build)
- **@huggingface/transformers** (do przyszłego STT lokalnego)
- **electron-builder** (deps rebuild)

---

## Start tutaj

```bat
cd %USERPROFILE%\pq
npm install
npm run rebuild
npm run dev
```
