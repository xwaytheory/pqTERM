# pq workbench (gauntlet live board)

## Relokacja drzewa roboczego (2026-09-17)

- Stabilna kopia pozostaje w `C:/Users/pq/pqTERM`; hub: `repo.git`; pozostałe kopie: `instances/dev`, `instances/test`, `instances/wip`, `instances/feat/engine-lifecycle` (ścieżki względem stabilnej kopii).
- Podczas przenosin zachowano referencje worktree, stashe i staged index WIP; nie odtwarzano drzew z czystego checkoutu.
- Smoke tworzenia i usunięcia worktree `test-fix` przeszedł; potwierdzono także zagnieżdżone ścieżki nowych gałęzi pod `instances/<branch>`.
- Starsze ścieżki w zapisach poniżej pozostają dowodami historycznymi; aktywne instrukcje wskazują nowe lokalizacje.

## i-have-adhd — project communication standard (2026-09-17)

- Explicit user opt-in: installed unmodified `ayghri/i-have-adhd` at `.agents/skills/i-have-adhd/` using `npx skills add ayghri/i-have-adhd --skill i-have-adhd --agent codex --yes`; provenance/hash in `skills-lock.json`, MIT notice in `.agents/skills/THIRD-PARTY.md`.
- `AGENTS.md` activates the communication style alongside Ponytail despite upstream's on-demand discovery flag. Answer/action first, bounded numbered steps, concrete progress, no tangents; safety, completeness, harness rules and explicit user requests win. No diagnosis inferred; session opt-out: `stop adhd mode` / `normal mode`.
- Scope: project instructions and portable skill files only; no global CLI configuration, runtime hooks, npm dependencies, app UI changes or version bump. CLI tools must load the project instructions; installation is not proof that every CLI automatically applies the style.
- Verification on dev: `npx skills list` discovers `i-have-adhd` alongside all six Ponytail skills; `scripts/verify-night.cmd` ALL OK (100 Node tests, both TS projects, Rust workspace tests, Tauri check, version check); `npm run build` PASS. No temporary verification files created.
- Release 1.2.0 (`2e66c00`): version synced 1.1.9 → 1.2.0 across package.json, package-lock, crates/, src-tauri/ (incl. locks via cargo), stamp-host.cjs, README. `check:version` caught `scopeguard@1.2.0` (genuine crates.io version colliding with the product bump); static allowlist entry added with a ponytail ceiling note (drop after product moves past 1.2.0).
- Gates: `verify-night.cmd` ALL OK on dev AND test (96 Rust + 1 + 9 Rust tests, Tauri check, 100 Node tests, both typechecks); `npm run build` PASS on dev; official `pqTERM`: `stamp-host.cjs` + `npm run build` PASS, `host\pqterm.exe` ProductVersion = 1.2.0 (FileVersion stays 1.1.7 by stamp design).
- Promotion: dev → test → main fast-forwards at `2e66c00`; pushed `f346a20..2e66c00` to `origin/dev`, `origin/test`, `origin/main` (user-requested). i-have-adhd adoption included in the same release train.

## CLI install window and Kimi logo — deployment 2026-09-17

- Approved release `3b8569d` was pushed to `origin/main` and `origin/test`; official host and bundles rebuilt. Installation remains the minimal visible cmd/PowerShell window; no managed uninstall subsystem.
- Kimi uses bundled `kimi.png` instead of the dead remote URL. Runtime check in official Electron: `file:///C:/Users/pq/pqTERM/out/renderer/assets/kimi-BYrmPowr.png`, `complete=true`, natural size 640×640. No installer or CLI was clicked during this runtime check.
- Integrated pinned `3b8569d` into development without promoting concurrent test changes. Merge preserves Notification/IPC imports and all unit suites. Development verification: 100/100 unit tests, both TS projects, check:version (existing 1.1.9), production build PASS.
- Final `scripts/verify-night.cmd`: ALL OK (106 Rust workspace tests, Tauri cargo check, version check, 100 Node tests and both TS projects). Integration commit: `1eac32d`.
- Full install → second-click launch UI flow was not exercised in this check. Existing profile isolation was not confirmed, so verification was read-only; the verification process was stopped.

Last update: **2026-09-16** (Europe/Warsaw) — UI: karty silników w NEW WORKSPACE w jednym rzędzie (logo po lewej, nazwa po prawej, jak w SPAWN ENGINE); `styles.css` `.chip` +4 linie (inline-flex, nowrap). Weryfikacja: `verify-night` ALL OK + `npm run build` OK (dev, `c5e0a5c` + change) + niezależny critic PASS. — deep audit gauntlet-loop @ `1a2d7ac` i domknięcie backlogu: 2. fala (P0 lock + 6 błędów `src-tauri`, single-instance, guard wersji, bramka typechecku main), 3. fala (hardening `remote.ts`, wydajność: debounce OSC + coalescing board + `live={active}` + `React.memo`; kontrakt `cmd.rs`↔`lib.rs` w testach; wyrównane docs) oraz **4. fala: scalenie niezacommitowanego WIP z `pqTERM-dev` (poller tytułów z bazy opencode) z naprawą zepsutego testu** — `verify-night` + `npm run build` + `cargo test` = zielone end-to-end
Product HEAD (`test` = `dev` = `main` = `origin/*`): **`85c7ecf`** · `chore(release): 1.1.8` · wersja produktu **1.1.8**
**Wypchnięte na `origin`**: `350b60f..85c7ecf` na `dev`, `main` i `test` (fast-forward, bez sily). Repo nie używa tagów, więc release nie ma taga — świadomie, nie przez przeoczenie.
Trzy commity tej sesji: `b3330b7` (fale 1–4 + ponytail), `5fcb55a` (board), `85c7ecf` (release 1.1.8). Poprzednie 4 produktowe (`0ec3ced`, `44843ad`, `feaa9b8`, `1a2d7ac`) są ich przodkami.
Working tree: **czyste** we wszystkich czterech worktree (`test`/`dev`/`main`/`pq-work` — status 0) · 3 stashe bezpieczeństwa (cudze WIP) · build zrobiony w `test` i w oficjalnym `pqTERM` (`stamp-host.cjs` + `out/`)
Critic mode: **ta sama sesja** (brak niezależnego Krytyka) → werdykt najwyżej **WARUNKOWO OK**

## Sidebar — ikona folderu i poprawka ściskania tytułów (2026-09-17)

- `pqTERM-test` (ISOLATED, zgodnie z zasadą użytkownika): mała szara ikona folderu przy ścieżce projektu otwiera katalog natywnie przez `shell.openPath` (`workspaces:openFolder`, walidacja nadawcy + `statSync` + obsługa błędu; Sidebar: `folderError` z `role=alert`). Bez nowych zależności.
- Regresja „rozjechanych” tytułów: pełny tekst `aktywność CLI` w wierszu sesji zabierał szerokość tytułowi. Fix w `styles.css` (test): `.activity-badge` = kropka 8 px (font-size 0), `.pane-label { flex:1; overflow-wrap:anywhere }`, `folder-open` 24 px + hover/focus. Statusowy tekst pozostaje w `title`/`aria-label` (dostępny dla czytników).
- Smoke Chromium 285×700 (fixture folder-check.tsx): tytuł 167 px przy badge 8 px, brak overflow; klik → tylko `open` (bez `select`), Enter na fokusie, alert błędu — PASS. Dev nie był restartowany; na dev została wcześniejsza wersja tego fixa (identyczna reguła).
- `npm run test:unit` (test): 80 PASS + oba typechecki; `npm run build` (test): PASS. Folder-check.tsx i procesy preview usunięte/stopowane po smoke.

## Czarny ekran na starcie — domknięcie integracji activity/notifications (2026-09-17)

- Symptom: `pqTERM-dev` startował do czarnego okna. CDP: `DeckScreen` `reportTerminalFocus` → `undefined.focus` oraz efekt montażu → `undefined.onChange`; React czyścił `#root` (tło `#07080a` = czarny ekran).
- Przyczyna: niedokończony cutover „statusy paneli + powiadomienia” — renderer/preload typy były, ale `window.pq.activity` i `window.pq.notifications` nie istniały w preload, a main nie miał IPC ani podłączonego trackera.
- Naprawa: preload expose `activity.{get,focus,onChange,onFocus}` + `notifications.set`; main (`index.ts`, `pty-manager.ts`, `store.ts`) podpięło `PaneActivityTracker` (start/output/naturalny kod wyjścia vs świadome zamknięcie), walidowane IPC (`requireRenderer`, booleans), natywne alerty Windows z kliknięciem do pane, normalizację `notifications` w stanie (dane użytkownika nietknięte).
- Weryfikacja: `npm run test:unit` 97 PASS (oba typechecki); `npm run check:version` PASS; `cargo test --workspace` 106 PASS; `npm run build` PASS; żywa instancja dev (CDP 9333): reload bez pageerror/console error, `activity.get()` zwraca 4 pane `running`, modal POWIADOMIENIA otwarty kliknięciem w UI, zapis/odczyt/przywrócenie ustawień OK, niepoprawny payload odrzucony. Nie ćwiczone na żywo: dostarczenie kliknięcia natywnego alertu OS.
- **Żywa weryfikacja alertów (2026-09-17, Electron 33, CDP 9334)**: rzeczywisty BEL z PowerShell (`[Console]::Write([char]7)`) → tracker `attention` + `unread:true` + badge „CLI wymaga uwagi”; natywne `Notification` Windows z emitowanym zdarzeniem `show` (treść „pq · PowerShell / CLI wymaga uwagi”, `silent` wg ustawień). `emit('click')` na rzeczywistej instancji → przeniesienie do właściwego workspace/pane (`activity:focus`), `unread:false`. Naturalne `exit 0` → alert „proces zakończony”. Intencjonalne zamknięcie (`term:clearPane`) → brak alertu i brak stanu tracker. Silnik obserwacji (`Notification.prototype.show`) wyłącznie w pamięci tego uruchomienia; kod produktu bez zmian od debugera.
- Poprawki cyklu życia trackera (pane-activity.ts): cisza ≥30 s → `quiet` (bez alertu); nowe wyjście → z powrotem `running`; naturalny koniec ignoruje późniejsze output/signal (jednorazowy alert); kontrolne ciągi DCS/SOS/PM/APC ignorują BEL do ST (także rozdzielone między porcje). Sidebar: status w nowej linii pod tytułem sesji (brak ściskania tytułów). Testy: 4 w `pane-activity.test.ts`.

## Powiadomienia — odzyskany kontekst i regresja BEL (2026-09-17)

- Sesja OpenCode: `gentle-forest`, `ses_f54bb2844ffeZq0ip6urIY5PRm`, utworzona 2026-09-16 o 19:30 (Europe/Warsaw). Użytkownik zatwierdził status panelu, natywne alerty Windows z opcjonalnym dźwiękiem i kliknięciem przechodzącym do panelu. Cisza nie oznacza ukończenia zadania; gotowość i oczekiwanie wymagają zdarzeń agentów.
- Stan odzyskany: `PaneActivityTracker` i typy współdzielone istnieją, ale tracker nie jest podłączony do PTY/main/preload/UI; brak natywnych powiadomień i ustawień. Nie jest to działająca funkcja end-to-end.
- Naprawa `pane-activity.ts`: usunięto warunek `lastBellAt === 0`, który blokował wszystkie kolejne BEL; wartość początkowa `-Infinity` pozwala na pierwszy alert także przy zegarze 0. Konstruktor zapisuje pola jawnie, zgodnie z uruchamianiem testów przez Node strip-types.
- Nowe `pane-activity.test.ts` włączone do `test:unit`: pierwszy BEL, niezależność paneli, tłumienie serii, granica 4999/5000 ms oraz BEL kończący OSC rozdzielony między porcje danych. Przed poprawką: 1 FAIL / 1 PASS; po: 2 PASS. Bezpośredni smoke rzeczywistego trackera również PASS (ponowny alert po 5000 ms i tłumienie natychmiastowego duplikatu).
- Bramki po poprawce: `npm run test:unit` 95 PASS wraz z oboma typecheckami; `npm run check:version` PASS; `scripts/verify-night.cmd` ALL OK; `npm run build` PASS. Nie testowano powiadomień Windows ani interakcji UI; brak promocji do test/main.
- Punkt kontynuacji: domknąć integrację PTY → tracker → status panelu / alert Windows, odróżniając naturalne zakończenie procesu od ręcznego zamknięcia. Dodatkowo odtworzono istniejący problem: nowe wyjście nie przywraca `quiet` do `running`; nie naprawiano go w zmianie dotyczącej BEL.

## Sidebar — usuwanie sesji i projektu (2026-09-17)

- `Sidebar.tsx`: × przy sesji CLI wywołuje istniejące `terminals.clearPane` (zamyka sesję, pozostawia slot idle); × przy projekcie wywołuje `workspaces.remove` po potwierdzeniu zamknięcia wszystkich sesji. Folder projektu pozostaje na dysku. Usunięto `delete ws` z `DeckScreen.tsx`.
- `styles.css`: stały rozmiar przycisków, widoczny fokus klawiatury, zawijanie długich tytułów bez wypychania przycisku.
- Smoke Chromium, 328×889: rzeczywisty komponent Sidebar z izolowanym mostkiem i danymi testowymi; zamknięcie jednej sesji, anulowanie usunięcia, usunięcie nieaktywnego projektu, Enter na przycisku, brak propagacji do wyboru projektu i brak poziomego overflow — PASS. Nie zamykano rzeczywistych sesji użytkownika ani nie testowano IPC end-to-end.
- `npm run build` — PASS. `verify-night.cmd`: wersje, 106 testów Rust i `cargo check` — PASS; `npm run test:unit` zatrzymany przez typecheck: brak typu `Seg` w niezmienianym `src/shared/grid.ts` (linie 194–270). Pełna bramka pozostaje czerwona; bez promocji do test/main.
- Bezpośrednie uruchomienie zestawu testów Node (poza zablokowanym typecheckiem): 79 PASS / 4 FAIL — wyłącznie istniejące scenariusze `resizePanes` w `src/shared/grid.test.ts` (181, 191, 210, 221); ten zakres nie był zmieniany.
- Niezależny reviewer potwierdził obecność obu akcji; zgłoszenie o `sidebar { width: 100% }` odrzucone jako niezgodne z kodem: istniejąca reguła używa `width: var(--sidebar)` i nie została zmieniona. Referencja 328 px obejmuje także dock, nie definiuje nowej szerokości sidebaru.

## Stage / progress

- **Stage:** produkt = Electron 1.1.7 + fala OSC pane-titles (adopcja tytułów z OSC CLaków) na `test`/`dev`; `main` jeszcze 1.1.6-era
- **Rough %:** Phase 2 (Rust) = rusztowanie ~95%, **cutover 0%** (produkt path nadal Electron)
- **`src-tauri` się kompiluje** (P0: lock + 6 błędów kodu) i ma **single-instance** → dwa procesy nie podzielą już portu :4747
- **Realny brak funkcjonalny w torze Tauri (nowy, precyzyjny):** nie ma mostka webview→Tauri (żadnego `window.pq` shimu) — renderer woła `window.pq.*` z preloadu Electrona, więc w Tauri UI nie ma jak działać. Uprawnienia `core:window:*` tego NIE naprawiają (patrz korekta niżej)
- **Gauntlet:** poprzednie fale A/B → *WARUNKOWO OK*; deep audit: **WARUNKOWO OK z 1 BLOKEREM P0** (P0 i P1 zamknięte); 3. fala: **WARUNKOWO OK** — jedyny otwarty bloker to mostek renderer→Tauri (3a), a werdyktu nie może podnieść ta sama sesja co autor
- **HTML board:** `docs/workbench.html` to **zamrożony snapshot** z 2026-09-13 (dostał banner z odesłaniem) — żywą tablicą jest ten plik

## Bramki (odpalone na `1a2d7ac`, dowody z tej sesji)

| Bramka | Wynik | Uwaga |
|---|---|---|
| `npm run test:unit` | **77 passed / 0 fail** (10 suites) **+ `typecheck` obu projektów** | 62 → 73 (2–3. fala) → 77 (4. fala: +4 `src/main/db-title.test.ts`); `test:unit` odpala najpierw `npm run typecheck` |
| `cargo test --workspace` | **106 passed / 0 fail** (pq-core 96 + pq-voice 1 + pq-work 9) | 98 → 106; doc-tests 0 |
| `npm run typecheck` (`tsconfig.json`) | **0 błędów** | było 5× TS5097 — `*.test.ts`/`*.smoke.ts` wyłączone z projektu (uruchamia je node, nie kompilator) |
| `npm run typecheck` (`tsconfig.node.json`, main!) | **0 błędów** | było **20**; naprawione realne błędy (index/remote/usage) + wyłączone pliki testowe |
| `cargo check` w `src-tauri` | **PASS** (online, `--offline`, `--all-targets`), **0 warningów** | było 56 warningów (45 dead_code stubów + 11 lint) |
| `npm run check:version` (nowe) | **OK** | sprawdza sync wersji + locki + `cargo metadata --locked` |
| `scripts/verify-night.cmd` | **ALL OK** (uruchomione end-to-end) | rozszerzone o `check:version` i `cargo check (src-tauri)` |
| `npm run build` (electron-vite: main + preload + renderer) | **✓ built** | renderer 706 kB JS / 28 kB CSS; potwierdza, że `memo`, `live={active}` i import typu `PqAPI` przechodzą przez bundler |
| `src-tauri/commands.test.ts` (nowe) | **6 passed / 0 fail** + **przetestowane mutacją** | po usunięciu `cmd::usage_tick` z `generate_handler!` test FAIL, po przywróceniu PASS |
| `cargo clippy --workspace` | 8 warningów (lib) + 10 (lib test) | nic krytycznego; `BOOL`/`DWORD`/`HANDLE` to typy WinAPI |

## BLOKERY

### P0 — NAPRAWIONE (2026-09-15): `src-tauri` nie kompilował się w ogóle

Dwie warstwy, obie usunięte — dopiero razem dają `cargo check` = OK:

**1) Lock** (przyczyna pierwotna, wada procesu bumpu)

- **Propose (stan repo):** bump wersji 1.1.7 „across package, crates, src-tauri, stamp-host, docs” (`11b420b`).
- **Krytyk pq:** bump zrobił **ślepy search/replace po `Cargo.lock`** i trafił w *cudzą* wersję: `toml 1.1.6+spec-1.1.0` → `toml 1.1.7+spec-1.1.0` (`src-tauri/Cargo.lock:4577-4581` wpis pakietu + 4 referencje w listach `dependencies`). Crate `toml` **nigdy nie miał 1.1.7** (kandydaci: `1.1.6+spec-1.1.0`, `1.1.0+spec-1.1.0`, `0.9.12+spec-1.1.0`). Dodatkowo **checksum został z 1.1.6** (`92060254…`) → lock byłby zły nawet gdyby wersja istniała.
  Dowód: `cargo check --offline` w `src-tauri` → `failed to select a version for the requirement toml >=0.9, <=1 (locked to 1.1.7+spec-1.1.0) … required by tauri-utils v2.9.3`.
- **Naprawione:** `src-tauri/Cargo.lock` — 5 odwołań do `toml` z powrotem na `1.1.6+spec-1.1.0` (4 referencje w listach `dependencies` + wpis pakietu). Check­sum nie wymagał zmiany: bump 1.1.7 ruszył **tylko string wersji**, więc checksum `92060254…` był już checksumem 1.1.6. `pq` w locku zostaje `1.1.7`.

**2) Kod — 6 błędów kompilacji odsłoniętych po naprawie locka** (dotąd niewidocznych, bo build padał wcześniej)

| Plik:linia | Błąd | Fix |
|---|---|---|
| `src/lib.rs:57` | E0382 `app` użyty po przeniesieniu do pierwszego `spawn` | `let updater_app = app.clone();` przed spawnem |
| `src/update.rs:69` | lifetime: domknięcie `norm` nie może zwracać `&str` | wyciągnięte do `fn norm_version(s: &str) -> &str` |
| `src/update.rs:191` | E0599 brak `creation_flags` (trait nie w zakresie) | `use std::os::windows::process::CommandExt;` (jak `cmd.rs:18`, `trust.rs:5`) |
| `src/update.rs:233/237/261` | E0433 brak `tauri_plugin_dialog::MessageDialogReply` | to `MessageDialogResult` (+ `blocking_show_with_result()`, bo `blocking_show()` zwraca tylko `bool` i gubi Yes/No/Cancel) |

**Dowód:** `cargo check` → `Finished dev profile (target)`, exit 0 — w trzech trybach: online, `--offline`, `--offline --all-targets`. Zmiany: `src-tauri/Cargo.lock` (10 linii), `src/lib.rs` (5), `src/update.rs` (30).

**Revise (zostaje):** bump wersji produktu ograniczyć do `[package] version` (nie globalny replace po lockach) — inaczej 1.1.8 znowu trafi w `toml`/`toml_parser` i tor Tauri znów padnie.

### P1 — `src/main/updater.ts` to martwy, niemożliwy do zbudowania moduł

- **Propose:** commit `36d083c` „remove Electron voice, **add git updater** + Tauri spike”; w `scripts/` miał leżeć `updater.cjs`, job w `<userData>/pq-update-pending.json`.
- **Krytyk pq:** pliku **nie importuje nic** (`index.ts` bez `PQUpdater`; brak referencji w `src/`), a sam plik się nie kompiluje:
  - `src/main/updater.ts:4-5` → `Cannot find module '../../shared/types'` (to ścieżka do `<root>/shared`, katalogu nie ma; poprawnie `../shared/types`),
  - `src/main/updater.ts:388` → `Cannot find name 'randomUUID'` (brak importu; w `index.ts:505` jest poprawnie `crypto.randomUUID()`) → `apply()` rzuca ReferenceError,
  - `scripts/updater.cjs` **nie istnieje na żadnej gałęzi** (`main`, `dev`, `test`), więc odpalony updater i tak by nic nie zrobił.
- **Revise:** zdecydować: albo podłączyć updater (poprawić import + `randomUUID` + dostarczyć `scripts/updater.cjs`), albo **usunąć plik**. Martwy plik z błędami kompilacji to fałszywy sygnał „mamy auto-update”.

### P1 — `image.save()` nie istnieje → cicha śmierć fallbacku wklejania obrazu

- **Propose:** `term:clipboardRead` / `term:clipboardReadImage` mają fallback „Electron native image” dla obrazów, których nie łapie surowy bufor.
- **Krytyk pq:** `src/main/index.ts:1028` i `:1068` wołają `image.save(filepath)` — `NativeImage` **nie ma metody `save`** (`tsc` → TS2339 w obu miejscach). Wyjątek leci do zewnętrznego `catch {}` w handlerze → użytkownik dostaje **pusty string** (wklejenie nic nie robi) bez żadnego logu. Ścieżka działa tylko dla obrazów z nagłówkiem PNG w surowym buforze.
- **Revise (WYKONANE 2026-09-15):** `writeFileSync(filepath, image.toPNG())` w obu handlerach + `catch (err)` loguje `[pqTERM] clipboard read failed:` zamiast cichego `return ''`.

## Wykonane w tej fali (2. fala, 2026-09-15)

| Co | Zmiana | Dowód |
|---|---|---|
| P0 lock | `toml` z powrotem na `1.1.6+spec-1.1.0` (5 miejsc) | `cargo check` zielony; `cargo` zachował 1.1.6 także po dodaniu nowej zależności |
| P0 kod | 6 błędów kompilacji `src-tauri` (tabela wyżej) | `cargo check` + `--all-targets` + `cargo test` (0 testów, ale pełny link grafu) |
| Single-instance | `tauri-plugin-single-instance = "2"` (2.4.4) jako **pierwszy** plugin; drugie uruchomienie pokazuje istniejące okno | `lib.rs` + `Cargo.toml`; `cargo check` zielony |
| Uprawnienia okna | dodane **tylko** `core:window:allow-start-dragging` | patrz korekta w tabeli AUDIT niżej |
| Martwy updater | `src/main/updater.ts` **usunięty** (474 linie) | `grep` = 0 referencji w `src/`, preload, renderer; tor Rust ma własny `src-tauri/src/update.rs` (kompiluje się) |
| `image.save` P1 | `toPNG()` + log zamiast cichego `''` | `tsc` czysty, `index.ts` ~1028/1068 |
| Warningi `src-tauri` | 56 → **0** | `cargo fix` (importy/`mut`) + `#![allow(dead_code)]` **z komentarzem** na czas spike'a (42 itemy stubów bez callera) |
| Bramka | `npm run typecheck` (oba projekty) wpięty w `test:unit`; `verify-night.cmd` + `check:version` + `cargo check (src-tauri)` | `verify-night` = **ALL OK** |
| Guard wersji | nowy `scripts/check-version-sync.cjs` (`npm run check:version`) | przetestowany na **podłożonej awarii**: wyłapał drift README, kolizję `toml=1.1.7`, i `cargo metadata --locked` → exit 1 |
| AGENTS.md | opisany nowy gate + zakaz globalnego replace po lockach | `AGENTS.md` golden commands |

## Wykonane w tej fali (3. fala, 2026-09-15)

| Co | Zmiana | Dowód |
|---|---|---|
| Hardening `remote.ts` (P2 3.4/3.5/3.6/3.7) | cap `/pair` 1 KiB → 413; cache statyków + 304; `decodeURIComponent` w `try`; LAN IP bez martwego warunku `family !== 4` | `tsc` czysty; `remote.ts` +81/−9 |
| Backpressure WS | `src/main/ws-coalesce.ts` (nowy) + `TermCoalescer` per gniazdo w `RemoteHub` | `src/main/ws-coalesce.test.ts` — **5 testów**: batching, cap, drop przy zapchanym peerze, porządek przy `flush`, `dispose` |
| Debounce OSC | 400 ms na skutki uboczne adopcji tytułu + `flushTitleSideEffects()` w `before-quit` | `src/main/index.ts` (+24); tytuł w pamięci zmienia się dalej natychmiast |
| Coalescing boardu | `BoardHub.requestFlush()` — 250 ms, skip-if-running, trailing run; interwał 2.5 s przez ten sam tryb | `src/main/board.ts` (+63/−10) |
| `live={active}` | terminale montuje **tylko aktywny workspace** | `DeckScreen.tsx`; PTY w mainie nienaruszony, replay buforka refilluje widok |
| `React.memo` | `TerminalPane` pod `memo` + `liveRef` w `DeckScreen` dla uchwytów drag | `TerminalPane.tsx`, `DeckScreen.tsx`; `npm run build` zielony |
| Kontrakt Rust↔JS | nowy `src-tauri/commands.test.ts` (6 testów) | mutacja `usage_tick` → FAIL; przywrócone → PASS |
| Guard hosta | `App.tsx` wykrywa brak `window.pq` i **mówi to zdaniem** zamiast crashować w Tauri | + `Titlebar` dostał `data-tauri-drag-region` (Elektron ignoruje) |
| Docs | 6 miejsc z kłamstwem „CURRENT Electron = `Xenova/whisper-tiny` w `voiceCommander.ts`” zdjęte; `MIGRATION-RUST` dostał sekcję statusu na 2026-09-15; `workbench.html` — banner snapshotu | patrz sekcja „Rozjazdy docs ↔ kod” niżej |

## Wykonane w tej fali (4. fala, 2026-09-15) — scalenie WIP z `pqTERM-dev`

`dev` i `test` stoją na tym samym commicie (`1a2d7ac`), ale `pqTERM-dev` trzymał **niezacommitowaną** pracę, której `test` nie miał (`git status` w `test` jej nie pokazywał, bo pliki żyły wyłącznie w tamtym worktree). Przeniesione — i naprawione tam, gdzie była zepsuta:

| Co | Pliki | Stan po porcie |
|---|---|---|
| Tytuł sesji z bazy opencode | `src/main/db-title.ts` (nowy) | `pickActiveTitle(rows, cwd)` — najświeższy (`time_updated`) niepusty tytuł dla znormalizowanego `cwd`; **`src/main/db-title.test.ts`, 4 testy** |
| Pytanie CLI o tytuł | `src/main/opencode-title.ts` (nowy) | `queryActiveOpenCodeTitle()` → `opencode db select directory, title, time_updated from session where time_archived is null --format json` |
| Poller tytułów DB | `src/main/index.ts` | start w `whenReady`, stop w `before-quit`; **jeden proces na workspace** co 5 s (nigdy na pane), tylko pane `opencode` bez `titleLocked` i żywe; wynik wchodzi przez `applyAutoTitle()` — czyli przez ten sam debounce 400 ms co OSC |
| Filtr archiwalnych sesji | `src/main/resume.ts` | `resume` nie proponuje już zarchiwizowanych sesji opencode |
| Reconnect z backoffem | `src/phone/src/client.ts` | 2,5 s → ×1,5 + jitter, limit 30 s, reset po rozłączeniu (telefon po wifi-setce nie stuka równo z innymi) |
| `about:` na Androidzie | `PqSttBridge.kt` | Kotlin odrzuca wewnętrzne strony WebView — mirror reguły, którą TS `originsMatch` miał od dawna |

**Naprawione przy porcie (realny defekt WIP):** dev importował `'./db-title'` **bez rozszerzenia**, a `node --experimental-strip-types` wymaga jawnego `.ts` → test dev **nie przechodził wcale** (`ERR_MODULE_NOT_FOUND`, 0 pass / 1 fail). Teraz test celuje w moduł z logiką (`db-title.test.ts` → `./db-title.ts`), a `opencode-title.ts` importuje statycznie **bez** rozszerzenia, bo `tsconfig.node.json` odrzuca jawne `.ts` w plikach kompilowanych (TS5097). Wynik: `77 passed / 0 fail`.

**Uwaga o metodzie:** w tym środowisku `git apply --3way` **raportuje sukces i nie zapisuje plików** („Applied patch to … cleanly”, a plik bez zmian). Po tym, jak podmienił fałszywy sygnał za prawdę, cztery hunki wprowadzone ręcznie i zweryfikowane `grep`em.

## Znalezione defekty (P2, nowe w tej fali)

| # | Co | Dowód | Skutek |
|---|---|---|---|
| 1 | ~~**OSC title → `persist()` + `board.flush()` na każdą zmianę tytułu**~~ **NAPRAWIONE (3. fala)** | `index.ts:101,470-496` (`applyAutoTitle` → `board.paneTitle` :484/:490 → `persist()` :498); `board.ts:98,209` (`paneTitle` → `flush()` → `git status`) | CLI, które animuje OSC title (spinner/progres), generuje **`git status` + 2 zapisy plików + pełny snapshot IPC/WS na każdą zmianę tytułu**. To jest teraz nowy, najczęstszy trigger znanej wady „full-snapshot broadcast na każdy persist”. **Fix:** adopcja tytułu nadal natychmiast w pamięci, ale skutki uboczne (board = `git status`, `persist()`, snapshot IPC/WS) coalesced **400 ms** (`TITLE_FLUSH_MS`); pending dociąga `flushTitleSideEffects()` w `before-quit`. `BoardHub.flush()` → `requestFlush()`: min. **250 ms** między przejściami, skip-if-running + trailing run. |
| 2 | **`oscTail` nie jest czyszczony w `kill()`** | `pty-manager.ts:90,186,199`; `kill()` ():158-172) nie woła `oscTail.delete`, a `onExit` wychodzi wcześniej na guardzie `sessions.get() !== session` | Drobny wyciek per ubity pane (bounded, ale niezerowy). |
| 3 | **Martwy dep `@xterm/addon-webgl`** | `package.json:67`; zero użyć w `src/` | ~ładuje się do bundla bez powodu (wisi od AUDIT-2026-09-12, poz. 4.5). |
| 4 | **`src/renderer/src/components/RemotePanel.tsx:13-17`** — poll `remote:info` co 1.5 s | istnieje push `board:changed`/`usage:changed`, ale nie ma `remote:changed` | Stały IPC nawet gdy panel zamknięty? (nie: poll tylko gdy panel otwarty) — ale nadal 4 kolejki/6 s na otwartym panelu. |
| 5 | **`bridge.ts` porównuje token `!==`** | `bridge.ts:``handle` (`token !== this.token`) vs `remote.ts:``safeEqual` (timing-safe) | Niespójność; localhost-only, więc niski priorytet. |
| 6 | **Zero `TODO/FIXME` w `src/`, `crates/`, `src-tauri/`** (grep = 0 trafień) | — | Dług techniczny istnieje wyłącznie w `docs/*.md`; czytający kod nie ma żadnego markera. Świadoma decyzja albo luka procesu — do rozstrzygnięcia. |

## AUDIT 2026-09-12 — co nadal otwarte (re-weryfikacja na `1a2d7ac`)

| Poz. AUDIT | Status | Dowód dziś |
|---|---|---|
| 2.2 brak single-instance (dwa procesy → dwa servery :4747) | **CLOSED** | `tauri-plugin-single-instance = "2"` (2.4.4) w `Cargo.toml` + `lib.rs` rejestruje go jako **pierwszy** plugin i `unminimize/show/set_focus` na istniejącym oknie |
| 2.3 „brak `core:window:allow-minimize/maximize/close/start-dragging`” | **KOREKTA — ta diagnoza była błędna** | `cmd.rs` ma własne komendy `window_minimize/maximize_toggle/is_maximized/close/set_title`; **własne komendy Tauri nie wymagają capability**, więc dodanie tych uprawnień byłoby przywilejem bez użycia. Realnie potrzebne jest **jedno**: `core:window:allow-start-dragging`, bo Tauri wstrzykuje `drag.js`, który z JS woła `plugin:window\|start_dragging` (`tauri-2.11.5/src/window/scripts/drag.js:104`). **Dodane.** Prawdziwy blocker titlebara to nie uprawnienia, a brak mostka webview→Tauri (patrz niżej). |
| 2.4 (nowe) brak mostka renderer→Tauri | **OPEN — realny blocker toru Tauri** | renderer woła `window.pq.*` (preload Electrona); w repo **zero** `invoke(`/`@tauri-apps` (`grep`), więc w Tauri nie ma warstwy pośredniej: `cmd.rs` (515 linii komend) jest nieosiągalny z UI, a `-webkit-app-region: drag` (styles.css:79,117) nie działa tak jak w Electronie — drag musi iść przez `data-tauri-drag-region` |
| 2.1 brak `src/main.rs`/`lib.rs`/`AppState` | **CLOSED** | `src-tauri/src/lib.rs:1-159` + `main.rs` + `cmd.rs` (515 linii) |
| 3.1 race kill/spawn w PTY (generation counter) | **częściowo** | Electron: guard jest (`pty-manager.ts` gen/session check w `onExit`). Rust: `crates/pq-work/src/pty_manager.rs` ma `MAX_BUF`/`cur_buf_len`, ale **brak `generation` countera** — sprawdzić, czy to świadome (Rust trzyma `Arc<Mutex<Session>>`, więc race może być nierozwiązywalny inaczej) |
| 4.1 ukryte workspace’y = pełne xterm w DOM | **CLOSED** | `DeckScreen` renderuje **tylko aktywny workspace**. PTY nie jest ubijany (żyje w mainie), więc powrót = spawn widoku + replay buforka + `existed: true` — ta sama ścieżka, której używał reload renderera |
| 4.2 zero `React.memo` | **CLOSED** | `TerminalPane` pod `memo` z komparatorem po propsach danych; handlery pominięte w porównaniu, bo czytają stan przez `liveRef` (zoom / lista pane / workspace) — inaczej zdarzony drag mógłby działać na nieaktualnym `zoomedId` |
| 4.3 `RemotePanel` poll 1.5 s | **OPEN** | `RemotePanel.tsx:13-17` |
| 4.6 WASM w installerze ~77 MB | **N/A obecnie** | `@huggingface/transformers` **nie ma już w `package.json`** (usunięte w `36d083c`) — instalator nie ciągnie już onnxruntime; pozycję zamknąć w docs |
| 3.4 WS bez backpressure | **CLOSED** | nowy `src/main/ws-coalesce.ts` (`TermCoalescer`, +5 testów): jedno gniazdo = jeden bufor, okno **16 ms**, cap **1 MB** oczekujących znaków (najstarszy pane idzie pod nóż, `dropped` liczy), a przy `bufferedAmount` > **4 MB** okno jest **porzucane** zamiast kolejkowane; `dispose()` na zamknięciu gniazda i `stop()`. `broadcast()` najpierw opróżnia ogon terminala, żeby ramka sterująca nie wyprzedziła wyjścia |
| 3.5 static serve `readFileSync` per request | **CLOSED** | `readStatic()`: cache ETag z `size+mtime` (do 32 plików) + **304** po `If-None-Match`; wcześniej 445 kB bundle telefonu leciał z dysku przy każdym żądaniu |
| 3.6 `/pair` bez capa body | **CLOSED** | cap `PAIR_MAX_BODY = 1024` (tyle ma JSON z pinem) → **413** + `req.destroy()` + `notePairFail()` (istniejący rate-limit odpowiedzi) |
| 3.7 `decodeURIComponent` bez try/catch | **CLOSED** | w `try` → 400 zamiast wyjątku lecącego z handlera żądania |
| 3.9 token plaintext + do env każdego pane | **OPEN (design)** | `bridge.ts` `envFor` → `PQ_TOKEN`; `remote.json` na dysku (`remote.ts` `loadPersist`) |
| 3.10/3.11 board flush co 2.5 s + full-snapshot na persist | **CZĘŚCIOWO (trigger zamknięty)** | coalescing `requestFlush()` (250 ms) + debounce OSC zamknęły **częstość** wywołań; sam **full-snapshot na każdy `persist()`** zostaje (osobna pozycja) |
| 3.12 `bun.exe` co 60 s dla omp usage | **OPEN (złagodzone)** | `usage.ts:~292` ma już `running` guard (skip-if-running), interwał nadal 60 s |
| 3.13 PTY dla każdego workspace na boot | **OPEN** | `index.ts` `restoreSessions()` w `whenReady` spawnuje wszystko z zapisu |

## Rozjazdy docs ↔ kod — NAPRAWIONE (3. fala)

Poniższe było prawdą jako opis stanu **przed** `36d083c`; w 3. fali zdjęte z dokumentów opisujących stan bieżący. Datowane snapshoty (`BACKLOG-NIGHT.md`, `NIGHT-REPORT-DRAFT.md`, `DAY-PLAN.md`) zostały nietknięte merytorycznie — dostały tylko odesłanie do tego boardu.

Zdania przepisane: `MIGRATION-RUST.md` (podsumowanie PL, tabela modelu, inwentarz plików, `package.json`), `VOICE-HOST-BRIDGE.md`, `ANDROID-STT.md`, `WHISPER-LARGE.md`, `PORT-MAP.md`. Nowy, prawdziwy stan: **desktop nie ma żadnej ścieżki STT**; `src/main/voice-host.ts` to opt-in spike, do którego nic nie woła `spawnVoiceHost`.

Dokumenty nadal opisują **usunięty** syntezator mowy Electrona jako produkcję:

- `docs/DAY-PLAN.md:45`, `docs/MIGRATION-RUST.md:9,47,154,157`, `docs/VOICE-HOST-BRIDGE.md:8`, `docs/NIGHT-REPORT-DRAFT.md:90`, `docs/ANDROID-STT.md:4` twierdzą, że **CURRENT Electron = `Xenova/whisper-tiny` w `voiceCommander.ts`** (production).
- Rzeczywistość: commit `36d083c` **usunął głos z Electrona** — `src/renderer/src/lib/voiceCommander.ts` i `VoicePanel.tsx` nie istnieją, `@huggingface/transformers` wypadł z `package.json`, w `src/renderer/src` nie ma ani jednego odwołania do voice/mic.
- `src/main/voice-host.ts` (690 linii) + `docs/VOICE-HOST-BRIDGE.md`: **inert** — nic nie woła `spawnVoiceHost` (jedyne referencje to re-export w `index.ts:1200-1207` i komentarz); w `before-quit` leci tylko no-op.
- **Wniosek dla itemu 8/9:** desktop **nie ma dziś żadnej ścieżki STT**, więc „parytet z Electronem” jest nieaktualny. Whisper Large v3 w `pq-voice` to od teraz jedyna ścieżka desktopu, nie „upgrade”.
- `docs/workbench.html` stoi na `3a06472` — **już nie jako defekt**: to zamrożony snapshot, ma banner i nie jest stemplem żywego stanu.

## Revise / next (kolejność)

1. ~~**P0:** naprawić `src-tauri/Cargo.lock` (`toml`)~~ — **zrobione**. ~~Zabezpieczyć proces bumpu~~ — **zrobione** (`npm run check:version` w bramce).
2. ~~**P1:** `src/main/updater.ts` + `image.save()`~~ — **zrobione** (usunięty / `toPNG()` + log).
3. ~~**Bramka:** typecheck `src/main`~~ — **zrobione** (`npm run typecheck` w `test:unit` + `verify-night.cmd`); main ma teraz 0 błędów.
3a. **Mostek renderer→Tauri** — nadal **otwarte i to jest główny bloker portu**. W 3. fali zrobione tylko to, co da się zweryfikować bez `tauri dev`: kontrakt `cmd.rs`↔`lib.rs` w testach, guard hosta w `App.tsx`, `data-tauri-drag-region`. Sam shim `window.pq` (mapowanie ~48 komend na ~40 metod; nazwy nie są 1:1 — `state_load` vs `state:load`, `pty_spawn` vs `term:spawn`) **nie został napisany świadomie**: bez uruchomienia toru byłby to kod zgadywany, a nie sprawdzony.
3b. **Reszta martwego kontraktu updatera:** po usunięciu `src/main/updater.ts` w `src/shared/types.ts` zostały nieużywane typy `UpdatePhase`/`UpdateSteps`/`UpdateStatus`/`UpdateJob` + `compareVersions` (tylko typy, zero runtime). Nie ruszałem ich w tej fali (edycja długich polskich komentarzy przez dopasowanie stringów jest zawodna) — do wycięcia, gdy updater w Rasta dostanie swój kontrakt.
4. ~~**Wydajność:** debounce tytułu OSC + coalescing `BoardHub.flush`; potem `live={active}` + `React.memo`~~ — **zrobione** (3. fala). Zostaje sam **full-snapshot na każdy `persist()`** (projekt, nie trigger).
5. ~~**Docs:** przeciągnąć `DAY-PLAN`/`MIGRATION-RUST`/`VOICE-HOST-BRIDGE`/`ANDROID-STT` do stanu „Electron bez głosu”; zstampować `workbench.html`~~ — **zrobione** (3. fala): zdjęte fałszywe twierdzenia o `whisper-tiny`, `workbench.html` dostał banner zamiast fałszywego stempla.
6. **Promocja:** `test` jest 4 commity nad `main` (`0ec3ced`,`44843ad`,`feaa9b8`,`1a2d7ac`) — po decyzji człowieka `test` → `main`.
7. **Niezależny Krytyk:** dopóki audyt robi ta sama sesja co autor, werdykt zostaje **WARUNKOWO OK**. Ścieżki P0/P1 są jednak weryfikowalne maszynowo (`cargo check`, `tsc -p tsconfig.node.json`), więc ich domknięcie nie wymaga „wiary w krytyka”.

## Czego ten audyt NIE sprawdził (uczciwie)

- ~~`src-tauri`: czy się kompiluje~~ — **sprawdzone i naprawione**: `cargo check` (online/offline/all-targets) + `cargo test` przechodzą; `cargo test` zbudował **cały graf zależności** (linkowanie zweryfikowane), ale `tauri dev`/GUI **nie był uruchamiany** — nie ma sensu bez mostka renderer→Tauri (patrz 2.4), a to okno na pulpicie użytkownika.
- `scripts/check-version-sync.cjs` nowy → konwencja EOL: plik ma LF, reszta `scripts/*.cjs` CRLF (kosmetyka; `git` znormalizuje przy commicie).
- `android/`, `src/phone/App.tsx`, `host/`, `resources/`, `out/`, `node_modules/` — bez zmian w tym audycie.
- `scripts/*.cjs` poza odczytem wersji; `docs/PARITY.md`, `docs/TAURI-SPIKE.md`, `docs/PTY-*.md` — nie czytane w tej fali (`PORT-MAP.md` czytany w 3. fali, poprawiony jeden wiersz).
- Brak testu E2E/„uruchom aplikację” — bramki to unit + typecheck + build; **żaden test nie łapie P1 z `image.save`** ani wydajności.
- **3. fala:** `live={active}` i `memo` przeszły `tsc` + bundling, ale **nie były klikane w oknie** — największe ryzyko to refaktor uchwytów drag w `DeckScreen` (przepisane na `liveRef`, żeby zdarzony handler nie działał na nieaktualnym `zoomedId`); do sprawdzenia wzrokiem przy pierwszym uruchomieniu `npm run dev`.
- **3. fala:** hardening `remote.ts` i coalescing WS zweryfikowane typami + 5 testami jednostkowymi kolejki; **żadna żywa sesja telefon↔PC nie była odpalana** (cap `/pair`, 304, backpressure na prawdziwym gnieździe — niesprawdzone w boju).
- **3. fala:** nowy koszt do świadomości — przełączenie workspace’u montuje wszystkie jego terminale naraz (spawn widoku + replay do 512 kB per pane), więc przy 9 pełnych pane i dużym buforze widać chwilę zacięcia; wcześniej były zamontowane na stałe. Zamiana: idle RAM/CPU ↔ koszt przełączenia.

## Zmiana procesu: skill `ponytail` (2026-09-15)

Minimalizm wpisany w `AGENTS.md` jako domyślny dla zadań kodowych: skill **`ponytail`** (`dietrichgebert/ponytail`, licencja **MIT**) zainstalowany projektowo w `.agents/skills/` — `ponytail` + `-review`, `-audit`, `-debt`, `-gain`, `-help`, poziom `full`. Drabinka: czy to ma istnieć (YAGNI) → jest w tym repo → stdlib → natywna funkcja platformy → zainstalowana zależność → jedna linia → minimum.

Granice zapisane wprost, bo „mniej kodu” bywa czytane jako „mniej kontroli”: walidacja na granicach zaufania (`src/preload`, handlery IPC, `/pair`, wejście WS), obsługa błędów, bezpieczeństwo i dostępność **nigdy** nie są cięte, a bramki repo (`test:unit`, `typecheck`, `check:version`, `verify-night`) zostają zielone — „mniej kodu” nie znaczy mniej testów.

Efekt uboczny: domyka się pozycja #6 z audytu („zero markerów długu w kodzie”) — świadomy skrót dostaje komentarz `// ponytail: <pułap>, <kiedy podnieść>`, który `ponytail-debt` zbiera w rejestr (zamiast `TODO`, które gnije).

**Rollout — wszystkie instancje:** `pqTERM-test`, `pqTERM-dev`, `pqTERM`, `pq-work`. Każda ma `.agents/skills/` (6 skilli), sekcję w `AGENTS.md` i `.claude/` w `.gitignore`. Dodatkowo katalog użytkownika `~/.agents/skills/` (`--global`) — dzięki temu `skill ponytail` ładuje się **po nazwie** w sesji, a nie tylko przez `AGENTS.md`.

Instalator dokłada `skills-lock.json` (SHA-256 per skill) — idzie do commita razem z `.agents/`. `.claude/skills/*` to bezwzględne symlinki w konkretną kopię, dlatego ignorowane.

⚠️ W `pq-work` plik `AGENTS.md` był **już staged** przez inną sesję (`MM`), więc moja sekcja leży na cudzej niezacommitowanej zmianie tego pliku. Poza `AGENTS.md` i `.gitignore` nie ruszałem tam niczego.

## Kaskada `test` → `dev` → `main` (2026-09-15)

Cztery fale + ponytail zebrane w **jeden commit `b3330b7`** na `test` (`56 plików, +1813/−658`, w tym 16 nowych). Potem fast-forward: `git merge --ff-only test` w `pqTERM-dev` (`dev`) i `pqTERM` (`main`) — `main` był przodkiem `test`, więc **żadnych merge-commitów ani konfliktów**. Bramka po zmergowaniu, odpalona na `main` w `pqTERM`: **`verify-night ALL OK`**.

Cudza niezacommitowana praca **nie zginęła** — jest w stashach (wspólny store, każdy opisany):

| stash | skąd | co zawiera |
|---|---|---|
| `stash@{0}` | `pq-work` (`main`) | WIP innej sesji: 40 plików +130/−488, w tym **usunięcie `osc-title.ts`** (stan sprzed fali OSC) |
| `stash@{1}` | `pqTERM` (`main`) | rozjechany `src/main/resume.ts` (201 vs 189 linii) |
| `stash@{2}` | `pqTERM-dev` (`dev`) | WIP dev — **już przeniesiony** do 4. fali, więc stash jest tylko kopią |

Podgląd/powrót: `git -C <worktree> stash show -p stash@{N}` → `git stash pop stash@{N}` **w tym samym worktree, z którego pochodzi**. Pułapka: `stash@{0}` i `{1}` zawierają też moje `AGENTS.md`/`.gitignore`/`.agents/` z chwili pakowania — po kaskadzie te pliki są w gicie, więc `pop` może się zderzyć; bezpieczniej obejrzeć `stash show -p` i wyłuskać tylko potrzebne pliki.

Notka historyczna (2026-09-15): nazwa `pq-work` poniżej oznacza obecną lokalizację `C:\Users\pq\pqTERM\instances\wip`; liczby i stan opisują tamtą sesję.

## ⚠️ Ryzyko w `pq-work`: staged zmiany **kasują** OSC pane-titles

`pq-work` (branch `main`) trzyma **zacommitowane do indeksu** zmiany z innej sesji: 40 plików, **+130/−488** — w tym **usunięcie `src/main/osc-title.ts` (80 linii) i `osc-title.test.ts` (95 linii)**, czyli dokładnie tej fali, która jest produktem na `test`/`dev` (`1a2d7ac`).

To nie jest praca do „dokończenia”: to gałąź stanu **sprzed** fali OSC. Jeśli ktoś w `pq-work` zrobi `git commit` bez czytania `git status`, funkcja adopcji tytułów zniknie z `main` przy najbliższym mergu, a bramka tego nie złapie (usunięcie pliku to nie błąd typów).

- **Nie ruszałem** tego (cudza niezacommitowana praca).
- Przed jakimkolwiek mergem `test`→`main`: `git -C C:\Users\pq\pqTERM\instances\wip diff --cached --stat` i decyzja człowieka — `git restore --staged .` albo świadomy commit.
- To samo dotyczy `C:\Users\pq\pqTERM`, gdzie `src/main/resume.ts` jest **całkowicie rozjechany** z `HEAD` (201 vs 189 linii) — inna, niezacommitowana wersja pliku.

## Korekta: „martwa kopia” to **katalog metadanych gita** (nie śmieć)

Ścieżki w poniższym dowodzie są historyczne (sprzed relokacji z 2026-09-17); obecny hub to `C:/Users/pq/pqTERM/repo.git`, a worktree testowe to `C:/Users/pq/pqTERM/instances/test`.

`C:/Users/pq/pq/worktrees/pqTERM-test` to **katalog metadanych worktree `test`**: plik `gitdir` w środku wskazuje `C:/Users/pq/pqTERM-test/.git`, a obok leżą `HEAD`, `index`, `commondir`, `ORIG_HEAD` i `logs/`. **Skasowanie tego katalogu zepsułoby `git status` w `test`** — wcześniejsza rekomendacja („usunąć martwą kopię”) była błędna i została wycofana **przed** wykonaniem, po sprawdzeniu zawartości.

Po co ta notka: w opisanej sesji ścieżki **relatywne** trafiały właśnie tam, przez co czytanie `worktrees/pqTERM-test/...` zwracało **stary snapshot z 2026-09-14 18:21** (bez `osc-title.ts`, jeszcze z `src/main/updater.ts`). Obecnie każda sesja pracująca na test powinna używać ścieżek **absolutnych** `C:/Users/pq/pqTERM/instances/test/...`.

- Nietknięte: cała ta kopia drzewa z 2026-09-14 (`AGENTS.md`, `README.md`, `android/`, `crates/`, `docs/*`, `host/`, `src/` …) — nie moja, **do decyzji człowieka**.
- Usunięte: wyłącznie **mój** plik zapisany tam przez pomyłkę (porzucony szkic `docs/workbench.md`, 12 716 B, 18:07). Prawdziwy board = ten plik (24 kB+).
