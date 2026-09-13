# AUDIT pq — Electron na Tauri/Rust (port #1)

Głęboki audyt z krytykami (Gauntlet Loop). Cel: feed do portu Rust w terminalu #1 (`src-tauri/`).
Data: 2026-09-12. Status Electron: `typecheck clean`, renderer build OK.

---

## 1. Co krytycy już naprawili w tym repo (Electron + renderer)

| Zmiana | Plik | Efekt |
|---|---|---|
| Generation counter w PTY | `src/main/pty-manager.ts` +8 | Fix race kill/spawn: stary `onExit` nie usuwa nowej sesji ani nie wysyła phantom `term:exit` |
| Usunięty double `board.paneEnd` | `src/main/index.ts` −1 | `term:clear` nie woła `paneEnd` 2× |
| `kill()` wysyła `term:exit` z guardem `isDestroyed()` | `src/main/pty-manager.ts` +4 | Jedno zdarzenie exit, bezpieczne na zdestroyowanym oknie |
| **Lazy STT** — dynamiczne `import()` transformers + WASM | `src/renderer/src/lib/voiceCommander.ts` | Initial chunk 1912KB → **481KB**; ~78MB WASM schodzi tylko przy pierwszej transkrypcji |
| Build renderer pod Tauri | `scripts/build-renderer.cjs` + `pq.renderer.vite.config.ts` (nowe) | `beforeDevCommand`/`beforeBuildCommand` z `tauri.conf.json` wreszcie działają |

**Uwaga typowania:** tsc czysty po zmianach.

---

## 2. BLOCKERY — port Tauri się teraz nie skompiluje

1. **Brak `src/main.rs` i `src/lib.rs`** — `Cargo.toml:7-11` deklaruje `[lib]` + `default-run`, ale nie ma żadnego binary/lib, który woła moduły. Pierwsza rzecz do napisania.
2. **Brak `tauri-plugin-single-instance`** — bez niego wraca bug #14 (dwa procesy → dwa serwery na port 4747, podział tokenu /pair). Dodać do `Cargo.toml:deps` od razu, bo wybór depów dziś = regresje jutro.
3. **Zamykanie okna** — `tauri.conf.json:24` ma `decorations: false` (custom titlebar), ale `capabilities/default.json:6` daje tylko `core:default` + `dialog:default`. **Brak `core:window:allow-minimize/maximize/close/start-dragging`** → guziki i drag area umarły. Preload: `window:minimize/maximize/close` musi mieć mapowanie na Tauri commands.
4. **Brak src-tauri module `main.rs` w board** — kolejność portu ma znaczenie (patrz sekcja 5).

---

## 3. 15 pułapek Electrona, które NIE mogą wrócić w Rust

Potwierdzone na realnym kodzie (file:line), sposoby na Rust:

1. **Race kill/spawn** (`pty-manager.ts:115,175-181`) — `mpsc::channel + generation u32` na panę; wait-czytnik łapie `(pane_id, generation)` i czyści tylko gdy `generation == current`. Krytyczne #1.
2. **`exitedInternally` w prywatne pola node-pty** (`pty-manager.ts:74-79`) — portable-pty: używać `wait()`, nie macać wewnątrz.
3. **`lastBuf` nigdy nie ewiktowany** (`pty-manager.ts:83,178,216,254`) — replay to `VecDeque<u8>` cap ~4MB, truncate na `clearPane`/respawn i na usunięciu workspace.
4. **WS bez backpressure** (`remote.ts:453-459`) — każdy chunk = osobny JSON. Rust: `HashMap<client_id, mpsc::Sender>` + coalescing co ~16ms + `poll_ready`/drop na zatkany kanał. Krytyczne #4.
5. **Static server `readFileSync`/request, zero cache** (`remote.ts:588-606`) — bundle telefonu (445KB) ściąga się za każdym wejściem. Tauri: wczytaj raz do `Arc<Vec<u8>>` + `ETag`/`If-None-Match → 304`.
6. **Unbounded `/pair` body = publiczny DoS** (`remote.ts:563-567`) — `take(1024)`; czekaj z rate-limit po IP (`cf-connecting-ip`).
7. **`decodeURIComponent` bez try/catch** (`remote.ts:590`) — wisi socket. Rust: `percent_decode_str().decode_utf8_lossy()`.
8. **`shell.openExternal` bez allowlisty** (`index.ts:487-490`) — LLM w yolo-agenecie może kliknąć link z schematem niestandardowym. Rust: command/plugin ograniczony do `http(s)`.
9. **Token plaintext na dysku + do env każdego pane** (`bridge.ts:166-186`) — Rust: token w pamięci, sha2 tylko do weryfikacji /pair, nigdy w env dziecka.
10. **Board flush = git status + 2 zapisy co 2.5s** (`board.ts:66-69,193-223`) — coalescing ≥250ms + `skip if running`, timeout 5s na git.
11. **Full-snapshot broadcast na każdy persist** (`index.ts:435-439`) — diffować, emit tylko `state:changed` gdy bajty się różnią (retain `last_serialized`).
12. **`bun.exe` co 60s na query omp usage** (`usage.ts:219-263`) — cache/rzadziej.
13. **Boot: PTY dla każdego workspace + `opencode db select` per (ws,engine)** (`index.ts:96-141,873`) — spawn **tylko** na `term:spawn`/`clearPane`, nie na starcie.
14. **Brak single-instance lock** — patrz sekcja 2.2.
15. **Sync bez overall timeout** (`sync.ts`) — `tokio::time::timeout` na całą pętlę engine'ów, single-flight.

---

## 4. Renderer (wspólny Electron + Tauri — to samo `out/renderer`)

1. **Ukryte workspaces = pełne xterm w DOM** (`DeckScreen.tsx:252-277`) — 27 żywych terminali (scrollback 4000 każdy ≈ 500MB RAM) + strumień leci do ukrytych. Naprawa: prop `live={active}` na `TerminalPane`, mount terminala tylko dla aktywnego ws; replay po wejściu już istnieje (`term:spawn` zwraca `{replay, replaySeq}`), ale jest martwym kodem. Dodatkowo main nie powinien wysyłać `term:data` dla nieaktywnych pane (grep `shouldStream`).
2. **Zerowe `React.memo`** — pełny snapshot na każdy persist = rerender całego drzewa. Dodać `React.memo` na `TerminalPane`/`Sidebar`.
3. **RemotePanel poll 1.5s** (`RemotePanel.tsx:13-17`) — zamiast tego subskrypcja push (RemoteHub już wysyła zmiany).
4. **VoicePanel rerender 20-46Hz** (`VoicePanel.tsx:40-45`) — meter przez ref.
5. **`@xterm/addon-webgl` dead dep** (`package.json:34`) — wywal.
6. **WASM w installerze nadal 77MB** — runtime załatwione; cut instalacyjny: trzymać tylko `ort-wasm-simd-threaded.wasm` (12.9MB), reszta (jsep/asyncify/jspi) do wywalenia z `wasmPaths`.

## 5. Architektura portu (krytyk #6 — kierunek)

Jedno drzewo proces-lifetime zamiast klonowania jednego-thread-per-job z Electrona:
**per-pane `Arc<Mutex<PtySession>> {pane_id, generation, replay, child, reader}` + task panie** (`drain → batch → bounded channel`),
**jeden `RemoteServer` z `poll_ready` i backpressure** (remote to tylko drenaż pty API),
**jeden `BoardTask` + `UsageTask`** z coalescingiem i skip-if-running,
**wszystko za jednym `AppState`** w managed state = jedyne choke-point dla tokenu w pamięci, capów body i debounced zapisu.

Kolejność: naprawić Cargo.toml (single-instance, opener) → `main.rs`/`lib.rs` + `AppState` → **sketch PtyManager z generation counter przed serwerem remote**.

Kontrakt IPC (preload `index.ts` ↔ Tauri commands/events — nazwy muszą się zgadzać 1:1):
- events: `state:changed`, `board:changed`, `usage:changed`, `sync:event`, `term:data` (paneId, data, seq), `term:exit` (paneId, code)
- sends: `term:write`, `term:resize`, `window:minimize/maximize/close`

---

## 6. Zostało do zrobienia (backlog)

- [ ] `src-tauri/src/main.rs` + `lib.rs` + `AppState`
- [ ] `tauri-plugin-single-instance`, opener allowlista, `core:window:*` permissions w capabilities
- [ ] PtyManager (generation) — **przed remote**
- [ ] RemoteServer (backpressure, /pair cap, ETag static, percent-encoding safe router)
- [ ] Board/Usage z coalescingiem
- [ ] Lazy spawn (żadnych PTY na boot)
- [ ] `npm audit` + lock na electron 33 (rcedit/electron lock), CSP phone jak w tauri.conf
- [ ] Trim WASM instalacyjny do jednego pliku
- [ ] Synchronizacja kodu prowizorycznie: window controls w Tauri `core:window`