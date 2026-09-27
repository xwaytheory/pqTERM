# pq workbench (gauntlet live board)

## „CLI wymaga uwagi” zostaje, choć CLI dalej pisze (2026-09-27, `dev`)

**Zgłoszenie:** pane w trakcie pracy (omp pisze kod, woła narzędzia) ma badge
„CLI wymaga uwagi” i bursztynową ramkę.

**Root cause:** `TERM_PROGRAM=pq` + `COLORTERM=truecolor` → omp bierze profil
`trueColor`, a jego powiadomienie to surowy BEL (`\x07`) na końcu tury.
`PaneActivityTracker.output()` ustawiał `attention` i już go nie zdejmował:
kolejny stdout wracał do `running` tylko z `quiet` i `waiting`. Jedno
zakończenie tury zostawiało badge na całą następną turę.

**Fix:** BEL / OSC 9 / `signal('attention')` dalej podnoszą badge (cisza go
trzyma — koniec pracy bez dalszego pisania zostaje „wymaga uwagi”). Następny
chunk wyjścia, z późniejszym zegarem niż sam dzwonek, wraca do `running` i
zeruje `unread`. Ten sam chunk co dzwonek (ta sama milisekunda) nie zdejmuje
go. OSC/DCS BEL bez zmian.

**Test:** `pane-activity.test.ts` — „BEL attention clears when the CLI keeps
writing, and stays when it stops”.

## Pierwsze NEW WORKSPACE nie bierze tytułu ani katalogu (2026-09-27, `dev`)

**Zgłoszenie:** pierwsze otwarcie NEW WORKSPACE nie przyjmuje tytułu ani ścieżki.
Siatka, silniki i create działają (pusty tytuł kończy się „nadaj tytuł…”).
Zamknięcie dialogu i drugie otwarcie już działa.

**Root cause:** klik w pane fokusuje ukryty `textarea.xterm-helper-textarea`.
Ten fokus przeżywa klik „+ new” — `focusRequest` i tak jest 0, więc nic go nie
zdejmuje. Pierwsze pokazanie dialogu pisze w terminal pod spodem, a systemowy
wybór folderu wraca od razu jako anulowany. Zamknięcie przenosi fokus na
przycisk, dlatego drugie otwarcie było czyste.

**Fix:** otwarcie modala bluruje helper, pole tytułu bierze fokus po kliku,
`body.modal-open` wyłącza helperowi hit-test, `.modal-back` jest `no-drag`,
inputy mają `user-select: text`. `pickFolder` fokusuje okno zanim pokaże dialog.

## Nowa kopia z GitHuba startuje bez workspace’ów (2026-09-27, `dev`)

**Zgłoszenie:** pierwsze pobranie pqTERM na inny komputer otwierało się z już
istniejącymi workspace’ami. Ma być puste, jakby nikt ich tam nie zakładał.

**Root cause:** pierwszy start profilu `pqTERM-pr` / `pqTERM-dev`, gdy brakowało
jego `pq-state.json`, kopiował i czytał stary profil `%AppData%\Roaming\pq`
(albo `pq-dev`) razem z sesjami. W gicie tego pliku nigdy nie było.

**Fix:** `resolveProfileState` patrzy tylko na plik tego profilu. Brak pliku
to pusta lista. Istniejący `%AppData%\Roaming\pqTERM-pr\pq-state.json` zostaje.
`pq-state.json` jest w `.gitignore`, więc nie wjedzie do klona. Bliźniak w
`crates/pq-core` też czyta tylko swój plik.

**Test:** `profile-state.test.ts` — stary plik `pq\pq-state.json` nie jest
nawet pytany; jest tylko plik nowego profilu.

## pqterm update i pasek „jest nowsze na GitHub” (2026-09-27, `dev`)

**Zgłoszenie:** z cmd `pqterm update` ma dociągnąć przestrzeń pqTERM z GitHuba.
Przy każdym starcie program ma raz sprawdzić, czy GitHub jest do przodu, i powiedzieć,
że warto wpisać tę komendę. Drugi komputer ma tak łapać zmiany zrobione tutaj.

**Fix:** `scripts/pqterm-update.cjs`. `pqterm update` robi `git fetch` i fast-forward
tylko czystych kopii `main`, `dev` i `test`. Brudne drzewo, rozjazd historii, `wip`
i `feat/*` są pomijane i nazwane w konsoli. Zmiana `package.json` / `package-lock.json`
odpala `npm install` w tej kopii. Commit na oficjalnym drzewie (albo jedyna kopia
na drugim komputerze) odpala `npm run build`. Jak `pqterm.exe` jest otwarty, ta kopia
nie jest ruszana — komenda każe ją zamknąć i wpisać się jeszcze raz. Przerwana
przebudowa zostaje w `%LOCALAPPDATA%\pqTERM\rebuild.txt`.

Start aplikacji odpala ten sam skrypt z `--check` (fetch jednej gałęzi, bez merge)
i z `--ensure-cmd` (dopisuje `%LOCALAPPDATA%\pqTERM\bin` do PATH użytkownika i
kładzie tam `pqterm.cmd`). Pasek nad deckiem pokazuje tekst z `--check`. Origin
inny niż `github.com/xwaytheory/pqTERM` jest odrzucany.

**Test:** `src/main/pqterm-update.test.ts` — wybór worktree, ff tylko gdy GitHub
jest ściśle z przodu, install/build, tekst paska, PATH, wiersz przerwanej przebudowy.
`npm run test:unit` na `dev`: **143 PASS** (oba typechecki w środku).
`--check` na tej kopii zwraca `{"notice":null}` — GitHub nie jest z przodu.

## Klik w pane nie zrzuca widoku na górę (2026-09-26, `dev`)

**Zgłoszenie:** klik kursorem w inne okno przewija je na samą górę. Treść jest na dole.
Nie zależy od CLI.

**Root cause:** `.xterm-viewport` ma `overflow-y: scroll`. Chromium przy fokusie
kotwiczy scroll i ustawia `scrollTop` na 0. xterm w `Viewport._handleScroll`
bierze to za gest użytkownika i ustawia `ydisp` na 0 — stąd skok na początek
bufora. Dodatkowo `left: -9999em` na `.xterm-helper-textarea` (xterm.css)
przy fokusie też ciągnie przewijanie w górę, a efekt `fit()` na zmianie
`focused` odpalał ten sam scroll przy każdym kliknięciu.

**Fix:** `overflow-anchor: none` na viewporcie, `left: 0` na helperze,
`focused` wyjęte z zależności fitu. Zoom dalej przebudowuje rozmiar.

## Wybór gridu to miniatura, nie cyfra (2026-09-26, `dev`)

**Zgłoszenie:** w NEW WORKSPACE i EDIT WORKSPACE nie pokazywać `1, 2, 3, …`.
Ma być inny, sprawdzony wybór, aż do 20.

**Fix:** te same dwa dialogi (`NewWorkspaceModal`) rysują 20 miniatur
`defaultAreas` — ten sam wzór co snap layouts (kształt kratek, nie numer).
Liczba okien jest drobną cyfrą w rogu miniatury oraz w `aria-label` i tooltipie.
Telefon zostaje przy `LAYOUTS` 1–9.

## Plus nie zjada pierwszego okna; limit 20 (2026-09-26, `dev`)

**Zgłoszenie:** „+” w nagłówku ostatniego CLI dodaje okno, ale pierwsze okno przepada.
Ma być najwyżej 20 okien, a 21. próba ma pokazać krótki komunikat. Siatka ma zostać równa.

**Root cause:** `addPane` brał prostokąty z `splitFromCells`. Ta funkcja wycina największą
kratkę i wstawia w jej miejsce dwie połówki, więc każdy późniejszy indeks przesuwa się
o jeden. Przy równych kratkach największa jest zawsze pierwsza (remis wygrywa indeks 0).
Dopięcie pane’ów po indeksie kładło okno 2 na połowę okna 1, okno 3 na miejsce okna 2,
i tak dalej. Nowe okno lądowało w ostatniej kratce, a pierwsze zapadało się w wąski pasek
(poniżej `MIN_PANE_W` terminal jest chowany — wygląda jak skasowany). Nic nie było
usuwane z `panes`.

**Fix:** `addPane` dokłada pusty pane (SPAWN ENGINE) i układa **wszystkie** istniejące
okna przez `defaultAreas` — ta sama re-siatka co zamknięcie i `setLayout`. Kolejność
pane’ów zostaje, więc pierwsze okno zostaje pierwszym. `defaultAreas` dla 10–20 to
równe rzędy (najwyżej 5 kolumn; 20 = 5×4). `splitFromCells` zostaje przy snapie.
21. okno: `addPane` zwraca `false`, nic nie dopisuje. Renderer pokazuje komunikat
„Maksimum to 20 okien. Więcej nie da się otworzyć.” (`MAX_PANES` w `types.ts`).
`setLayout` też nie przekroczy 20.

**Test:** `grid.test.ts` → „defaultAreas keeps every cell usable through 20 panes”
(1..20, każda kratka ≥ 0.2 × 0.2, bez dziur i bez nakładek).

## Cisza nigdy nie dzwoni: waiting bez toastu (2026-09-25, `main`)

**Zgłoszenie (zrzut, 6 paneli):** „nadal bezpodstawnie schodzą powiadomienia z okien CLI,
które w ogóle nic nie robią, a jedynie się załadowały” — toast „czeka na Ciebie” zaraz po
startcie panelu wypełnionego promptem.

**Root cause:** bramka z `e5aa05b` (alert tylko z okna, do którego coś wpisano) była
za wąska: `fillPanes()` pisze prompt do PTY przez `ptys.write()` → `onInput` →
`activity.input()` → `asked = true`. Panel wypełniony promptem jest więc formalnie
„w rozmowie”, a CLI po pracy milczy → 60 s ciszy → toast. Heurystyka ciszy nie umie
odróżnić „skończył, czeka na input” od „załadował się i stoi” — bo obie sytuacje wyglądają
tak samo: brak wyjścia.

**Fix (jedna zasada): cisza nigdy nie wytwarza alertu systemowego.** `tick()` w
`src/main/pane-activity.ts` eskaluje badge running → quiet → waiting nadal (status w
sidebarze/pasku pane), ale bez `onAlert` i bez `unread`. Usunięta też bramka `asked`
(`Entry.asked`, `input()` zostaje jako reset stretchu) — bez alertu w `tick()` nie ma
czego bramkować. Alerty systemowe zostają wyłącznie dla wyraźnych zdarzeń: BEL,
OSC 9/777 (`notice`), wyjście procesu (`exit`).

**Copy:** `NotificationsPanel` — „Cisza w wyjściu CLI nigdy nie oznacza ukończenia zadania
i nie uruchamia alertu… Powiadomienia systemowe przychodzą wyłącznie z wyraźnych zdarzeń:
BEL, OSC 9/777, wyjście procesu.”

**Testy:** `pane-activity.test.ts` — „silence after work…” i „a fresh pane…” przepisane:
badge eskaluje do `waiting`, `alerts` zostaje puste w każdym stretchu (z inputem i bez).
Bramki: `npm run test:unit` **134 PASS** (9 suit) + oba typechecki + `npm run build`;
w zbudowanym `out/main/index.js` `tick()` nie zawiera `onAlert`.

**Trade-off (świadomy):** CLI, które nie dzwoni BEL-em i nie wysyła OSC 9/777, nie da już
toastu po skończeniu pracy — tylko badge „czeka na Ciebie”. To świadomie oddane: fałszywe
alarmy z 6 paneli naraz były gorsze niż brak toastu. CLI z BEL/OSC działają jak dotąd.

## Ikony: przezroczyste tło i świeży cache (2026-09-24, siódma runda, `dev`)

**Korekta po zgłoszeniu:** marka była wprawdę o połowę mniejsza, ale czarne kafelki i
 Explorer pokazywały stare ikony z cache, więc efekt był nadal zły.

**Fix:** `square_tile()` składa teraz markę przez `transparent_mark()` na kwadratowym
`RGBA` tle o pełnej przezroczystości. Skróty wskazują osobny `pq-desktop.ico`, aby Explorer
nie użył ponownie cache dla starej ścieżki `pq.ico`. Marka pozostje przy 30% szerokości.

**Pomiar:** narożnik PNG/ICO `(0, 0, 0, 0)`; widoczna marka w `pq-256.png` ma bbox
`82×64` px, czyli około 32% szerokości i 25% wysokości. ICO nadal ma 7 rozmiarów.

**Bramki:** `npm run test:unit` 130/130 (oba typechecki), `node --check
scripts/make-shortcuts.cjs`, `npm run check:version`, `npm run build` — zielone.

## Ikony: marka o połowę mniejsza (2026-09-24, szósta runda, `dev`)

**Zgłoszenie:** zmniejszyć logo na ikonach co najmniej o 50%.

**Fix:** `PAD = 0.20` → `0.35`, więc marka jest dokładnie o połowę mniejsza:
30% szerokości i 24% wysokości kafelka zamiast 60% i 48%. Regeneracja
`python scripts/brand-import.py` odświeżyła 11 wyprowadzonych PNG/ICO; ICO nadal
zawiera 7 rozmiarów (16/24/32/48/64/128/256).

**Bramki:** pomiar zasady 30/24 na PNG 256/512, favicon 32 i ikonach Tauri;
`npm run test:unit` 130/130 (oba typechecki), `npm run check:version` i
`npm run build` — wszystkie zielone.

## Ikony: logo mniejsze, wokół oddech (2026-09-24, piąta runda, `dev`)

**Zgłoszenie:** podmiana ikon na logo pqTERM jest OK, ale logo jest „zmaksymalizowane” — ma
być dyskretniejsze: mniejsze, z dużą ilością czerni/przestrzeni wokół.

**Root cause (błąd w pipeline, nie gust):** `square_tile()` w `scripts/brand-import.py`
skalowało **kafelek**, a nie markę: `inner = side * (1 - 2*PAD)`, potem tworzyło `tile`
rozmiaru `inner`, wklejało przeskalowany canvas i dopiero to rozciągało do `size`. Czyli
`PAD` nie dodawało ani piksela marginesu — tylko skalowało obraz w dół i z powrotem (strata
jakości), a marka dotykała krawędzi. Pomiar `pq-256.png` przed zmianą: **content 100%
szerokości**. Zamierzone 6% marginesu nigdy nie istniało.

**Fix:** kafelek zostaje `side × side`, a do `inner` skaluje się wyłącznie marka
(`tile.paste(canvas.resize((inner, inner)), offset)`), przy `PAD = 0.20` → marka zajmuje
**60% szerokości i 48% wysokości** kafelka. Pomiar po regeneracji: `pq-256.png`, `pq-512.png`,
`favicon.png` (32), `src-tauri/icons/icon.png` (512) i `128x128@2x.png` — wszystkie 60/48
(favicon 62/50 przez zaokrąglenie). Tło zostaje czarne: master to JPEG na czerni, alfa
wymagałaby un-premultiply, a marka in-app (`brand-mark.png`) i tak jest przezroczysta —
„czerń albo przeźroczystość” ze zgłoszenia to wybór, nie kompromis.

**Regeneracja:** `python scripts/brand-import.py` → 11 plików: `pq-256/512.png`, `pq.ico`,
`favicon.png/.ico`, 5× `src-tauri/icons/*`. `.ico` dalej zawiera 7 rozmiarów (16–256).
`docs/LOGOS-INVENTORY.md` opisuje teraz realne 60% i jeden knob `PAD`.

**Bramki:** `npm run test:unit` (130/130, typecheck w prekroku) na `dev` i po ff na `test`.
Poza repo: ikona samego `host\pqterm.exe` (stamp) i istniejące `.lnk` na pulpicie sięgają
`resources/brand/pq.ico` wprost, więc nową kafelkę widać od razu po odświeżeniu ikon;
sam `pqterm.exe` wymaga `npm run stamp` przy zamkniętym pqTERM (EBUSY — nadal otwarte).

## Plus w ostatniej kratce, krzyżyk naprawdę zamyka okno (2026-09-24, czwarta runda, `dev`)

**Zgłoszenie:** (1) w ostatnim okienku CLI w gridzie ma być „+” — dodaje kolejne okno, ale
naprawdę: otwiera się puste, z całym SPAWN ENGINE; (2) „×” ma faktycznie zamykać okno CLI —
okno znika, a workspace przelicza się na mniejszą liczbę okien, reszta dostaje nowe rozmiary.

**Diagnoza (root cause):** pane'owy „×” (nagłówek `TerminalPane` i lista w `Sidebar`) wołał
`term:clearPane`, które robiło `ptys.kill()` + `engine:null` — sesja CLI umierała, ale **slot
zostawał** jako idle. Siatka dalej liczyła tyle samo okien, `layout` i `sidebarowe live/layout`
się nie zmieniały, więc z punktu widzenia użytkownika „× nic nie zamykał”. Dodania okna nie było
wcale — nowe pane powstawało tylko przez liczbę okien w edytorze workspace (`workspaces:setLayout`).

**Main (`src/main/index.ts`):** dwa helpery, każdy z własnym handlerem.
- `addPane(workspaceId)` → `splitFromCells(n+1, resolveAreas(panes).map(e => e.area))`: rozpoławia
  **największą** kratkę i nie rusza żadnego istniejącego prostokąta; nowy pane ma `engine: null`,
  czyli pokazuje SPAWN ENGINE. `layout` = liczba panes. Zoom jest zdejmowany (`zoomedPaneId: null`),
  inaczej świeżo dodane okno zostałoby schowane pod powiększonym pane.
- `removePane(workspaceId, paneId)` → `ptys.kill` + `closePaneNotification` + `board.paneEnd`,
  slot wypada z `panes`, `layout` = liczba panes, zoom czyszczony gdy dotyczył usuwanego okna.
  Reszta przechodzi na `defaultAreas(n)` — dziury nie da się załatać bez przesuwania sąsiadów,
  więc zamknięcie re-flowuje siatkę dokładnie tak, jak `workspaces:setLayout`.
  **Ostatnie okno** nie jest usuwane, tylko resetowane do idle (`engine:null`, bez
  `sessionHandle`/`model`/`titleLocked`) — workspace bez panes nie miałby już na czym pokazać „+”.
- `term:clearPane` **usunięte** (razem z metodą w `preload`): oba „×” (nagłówek + sidebar) idą
  teraz przez `workspaces:removePane`, więc nie ma już „zamykania”, które nic nie zamyka. Ścieżka
  telefonu (`remote` `term.clear`) zostaje bez zmian — nie ma UI, które jej używa.
- Świadome zamknięcie dalej nie alarmuje: `ptys.kill()` woła `onExit(..., intentional=true)`, więc
  tracker czyści stan bez alertu — ta sama droga co przed zmianą (wpis z 2026-09-17 niżej
  opisuje `term:clearPane`, który przestał istnieć).

**Renderer:** w nagłówku **każdego** pane jest „+” (kolor akcentu na hover) i zawsze obecny „×”.
Pierwsze podejście dawało „+” tylko prawemu dolnemu okienku (liczonemu po geometrii, bo po snapie
pane trzyma swój indeks w tablicy, a inną kratkę) — użytkownik chciał go mieć przy każdym oknie,
co usunęło pomocnik `lastPaneId()` i prop `isLast` (mniej kodu, żadnej geometrii w tym miejscu).
`×` w sidebarze
jest teraz widoczny także dla panes bez silnika (pusty slot też da się posprzątać). Zamknięcie
sprząta fokus po stronie renderera (`liveRef`, bo memoizowany pane może trzymać starszy handler)
i pokazuje błąd jako istniejący pływający `.pane-alert`.

**Test:** `grid.test.ts` → „splitFromCells halves the largest cell and moves nothing else”
(3 przypadki, w tym własny układ 60/40): dokładnie jedna kratka jest rozpołowiona, połówki sumują
się do niej i cała siatka dalej pokrywa ramkę bez nakładania. **Dowód mutacyjny:** wymuszenie
`largestCellIndex() → 0` daje FAIL tego testu (`22 pass / 1 fail`); po przywróceniu 23/23.

**Bramki:** `npm run typecheck` (oba projekty), `npm run test:unit` (**130/130**, 9 suit) i
`npm run build` na `dev`; po `merge --ff-only dev` na `test` ponownie `npm run test:unit`
(**130/130**), `npm run typecheck` i `npm run check:version` — zielone. Weryfikacja wizualna („+” dodaje
pusty pane z SPAWN ENGINE, „×” zwija siatkę z 3 do 2) należy do użytkownika.

## Paski znikają, Settings z zakładkami, theme na szarość (2026-09-24, trzecia runda, `dev`)

**Zgłoszenie:** (1) napis „workspace · pqTERM” na górnym pasku do wywalenia w całości;
(2) z dolnego paska statusu można zrezygnować w całości; (3) rozbudować „Settings” —
zębatka z porządnym zestawem ustawień całego pqTERM; (4) przemalować cały theme na
szarości/czerń zamiast zieleni.

**Decyzje użytkownika:** jeden gear = Settings z zakładkami
[wygląd · terminal · powiadomienia · silniki · telefon] (z docka znikają ⚙-providers, `!`
i ◯); szary chrome, terminal zostaje kolorowy — ANSI to dane CLI (diff, git status, logi),
nie theme.

**Warstwa danych (jedno źródło walidacji):**
- `UiSettings` w `src/shared/types.ts`: `accent`, `fontId`, `fontSize`, `cursorStyle`,
  `cursorBlink`, `scrollback`. `DEFAULT_UI` = `mono` · cascadia · 13 px · bar · blink · 4000.
- `sanitizeUi()` używa **i** nowy handler `ui:set` (z `requireRenderer`), **i** loader stanu,
  więc ręcznie popsuty `pq-state.json` nie wejdzie do renderera: klamp 9–20 px, 0–50 000 linii,
  akcent/czcionka/kursor tylko z zamkniętej listy, reszta → poprzednia wartość.
- Test `src/shared/ui.test.ts` (3 przypadki) dopisany do `package.json` (`test:unit`).

**UI:**
- **Titlebar bez środka** — dwa elementy, `justify-content: space-between`, cały pasek dalej
  przeciąga okno (jest frameless). `Titlebar` nie ma już propa `center`.
- **Dolny pasek statusu usunięty.** Zostały po nim tylko realne błędy: pływający
  `role="status"` (`.pane-alert`, `position: fixed`) nie zabiera już wysokości gridowi.
  Liczniki `engines N installed · M auth` przeniesione do zakładki Silniki.
- `NotificationsModal` + `ProvidersModal` → `NotificationsPanel` + `ProvidersPanel`,
  `RemotePanel` przerobiony na treść bez własnego modala; trzy modale zastępuje jeden
  `SettingsModal` (role=tablist/tab, focus trap, Escape, przywrócenie fokusu).
  Ustawienia **aplikują się od razu** — bez „zapisz”, źródłem prawdy jest snapshot
  z `state:changed`.
- **Terminal reaguje na ustawienia na żywo:** kursor/blink/scrollback to zwykłe zapisy opcji,
  a czcionka i rozmiar przeliczą siatkę na następnej klatce (`fit()` + `sendResize`) — bez tego
  PTY zostałby w starym rozmiarze (dokładnie ten defekt, który naprawialiśmy w rundzie 1).

**Theme:** `--green`/`--green-dim` → `--accent`/`--accent-dim` + `--wash` (delikatna mgiełka
akcentu) — 61 linii 1:1. Akcent `mono` (jasny neutral `#d5dae2`) jest domyślny, warianty
mint/blue/amber siedzą w `:root[data-accent=…]` i ustawia je `App`, więc login też je łapie.
Wszystkie miętowe literały (9× `rgba(57,255,182,…)`, `#39ffb6`, `#0c1a16`, `#10241e`) zamienione
na `color-mix`/zmienne. Paleta ANSI terminala zostaje normalna — znika tylko neonowy kursor
(`#39ffb6` → `#dfe4ea`) i ANSI „green” wraca do zwykłego `#3fb950`.

**Znalezione przy okazji (dwa defekty w CSS):** `.edition-chip` miał
`border: 1px solid var(--grid)`, a zmiennej `--grid` nigdy nie było — obramowanie chipa nie
istniało; jest `--line-2`. `.notification-error` **nie miał żadnej reguły**, więc błędy w
panelach były kolorystycznie niewidoczne; jest `.notification-error { color: var(--red) }`.

**Bramki:** na `dev` oba typechecki + `npm run build` + `npm run test:unit` z nowym plikiem
testów; po `merge --ff-only dev` na `test` ponownie `npm run test:unit` (129/129, 9 suit),
`npm run typecheck` i `npm run check:version` — zielone. Weryfikacja wzrokowa (theme, zakładki,
brak pasków) należy do użytkownika.

## Zgłoszenie użytkownika: fałszywe alerty po starcie, nowe logo, artefakty terminali (2026-09-24, `dev`)

Trzy zgłoszenia z jednej sesji, wszystkie na `dev` (worktree `instances/dev`).

### 1. „CLI zgłasza, że wymaga uwagi” zaraz po uruchomieniu

**Symptom:** po starcie pqTERM (i po doładowaniu workspace'ów) pane dostają toast
„czeka na Ciebie”, choć zostały tylko uruchomione, są puste i nikt w nich nic nie
napisał; w rzeczywistości nie wymagają uwagi.

**Root cause (konkretne linie, przed zmianą):** `src/main/pane-activity.ts` —
`tick()` liczył próg 60 s ciszy od `e.lastOutputAt`, a `start(paneId)` ustawia je na
moment spawnu. Pane, do którego **nikt nigdy nic nie wpisał**, i tak przechodziło
running → quiet (30 s) → waiting + alert (60 s). Heurystyka z `b2a1095` nie miała
żadnego warunku „czy to okno w ogóle o coś pytano”, więc każde świeże CLI (TUI
milczy po narysowaniu pierwszej klatki) kwalifikowało się do alertu po minucie.

**Fix:** bramka interakcji, jedno miejsce na całą ścieżkę wejścia:
1. `Entry.asked` (false w `fresh()`), nowa metoda `PaneActivityTracker.input(paneId)`
   — zeruje stretch ciszy (`lastOutputAt = now`, `waitingAnnounced = false`).
2. `tick()` eskaluje do `waiting` **tylko** gdy `e.asked`. Quiet (status bez alertu)
   bez zmian.
3. Jedno wąskie gardło wejścia: `PtyManager.write()` → nowy hook `onInput` →
   `activity.input(paneId)` w `src/main/index.ts`. Tędy idą klawiatura, paste,
   DnD, `term.write` z bridge’a i prompty z `panes.fill` — więc reguła jest jedna,
   a nie sześć.
4. Copy w `NotificationsModal` mówi wprost: alert „czeka na Ciebie” tylko z okna,
   do którego coś wpisałeś; świeże, nietknięte okno nigdy nie alarmuje.

**Dowód (mutacja):** nowy test „a fresh pane nobody asked anything stays quiet —
silence alone never alerts” (`pane-activity.test.ts`). Usunięcie bramki `e.asked`
z `tick()` → **FAIL** (`'waiting' !== 'quiet'`, dokładnie zgłoszony objaw);
z bramką → PASS. Stary test „silence after work escalates…” dostał
`tracker.input('p')` — cisza po Twoim pytaniu to nadal waiting (celowo).

**Residual (świadomy, nie ukryty):** cisza po Twoim pytaniu jest heurystyką —
długo milcząca komenda bez wyjścia (np. `npm run build`) może zaalarmować.
Alternatywa (wyłączenie heurystyki ciszy w całości, tylko BEL/OSC 9/777/exit)
została podana użytkownikowi do wyboru i nie została wybrana.

### 2. Logo: `pqTERM logo.jpg` → ikony i chrome aplikacji

- Master trafił do repo: `resources/brand/pq-master.jpg` (2670×1780, marka
  wyśrodkowana na czarnym banerze) + generator `scripts/brand-import.py`
  (Python/Pillow, świadomie offline — nie jest zależnością projektu). Jeden master
  i jedna recepta, żeby ikona w exe, favicon i marka w UI nie mogły się rozjechać.
- Regenerowane (auto-crop po treści z progiem jasności, kwadratowa kafelka, 6% marginesu):
  `resources/brand/pq-256.png` + `pq-512.png` + `pq.ico` (16/24/32/48/64/128/256),
  `src/renderer/favicon.png` + `.ico`, `src-tauri/icons/{32x32,128x128,128x128@2x,icon}.png`
  + `icon.ico`.
- Nowa marka in-app: `src/renderer/src/assets/brand-mark.png` (glify na przezroczystym,
  un-premultiply alfy z luminancji) → `<img>` w `Titlebar` (zamiast 9 kropkowego
  `grid-mark` w CSS) i w `LoginScreen` (zamiast ASCII „pq”). Martwy CSS usunięty.
- `scripts/stamp-host.cjs` dostaje `--set-icon resources/brand/pq.ico` — skróty
  na pulpicie mają `IconLocation = host\pqterm.exe`, więc bez ikony w samym binarnym
  Explorer/pasek zadań pokazywałby ikonę Electrona. `package.json` wyklucza master
  z paczki (`!resources/brand/pq-master.jpg`).
- `resources/brand/pq.svg` zostaje jako legacy (nigdzie nie jest renderowany) —
  opisane w `docs/LOGOS-INVENTORY.md`, żeby nie wyglądał na aktualną markę.

### 3. Terminale „rozjeżdżają się” przy każdej zmianie geometrii

**Repro od użytkownika (wszystkie zaznaczone):** zaraz po starcie, przy zmianie
rozmiaru okna (max/min/przywróć), przy przeciąganiu krawędzi pane, przy przełączaniu
workspace'ów, przy zoomie. To wykluczyło wariant „małe pane gęstej siatki”
(floor 20×8 z `6fcec31` był już naprawiony) i wskazało na ścieżkę attach/resize.

**Root cause A — PTY nigdy nie dostał rozmiaru widoku, gdy replay był pusty**
(`TerminalPane.start()`): po `spawn()` rozmiar PTY jest zapisywany do dedupe
(`lastSentSizeRef`) z raportu maina, ale jedyne `sendResize` na tej ścieżce
siedziało **w gałęzi replay** `if (res.replay && …)`. Boot spawnuje aktywny
workspace na sztywno **80×24** (`restoreSession`), a `term:spawn` dla żywej sesji
zwraca `existed: true` i tylko oddaje bufor — więc gdy CLI nie zdążyło nic
wypisać (zwykły wyścig, attach jest szybszy niż pierwsza klatka TUI), `replay`
był pusty i **żaden resize nie leciał**: TUI rysowało dla 80 kolumn w szerszym
xtermie, aż do pierwszego zdarzenia okna/pane/zoom, które „naprawiało” rozmiar.
Ten skok + klatka w starej szerokości = obraz z zgłoszenia.

**Fix A:** `sendResize(term.cols, term.rows)` wykonuje się teraz na **każdym**
attachu, po obsłudze replay (dedupe sprawia, że gdy PTY stoi w tym rozmiarze,
nic nie idzie).

**Root cause B — martwy `clearTimeout`:** linia 280 miała
`if (!spawned.current) return        clearTimeout(resizeTimer)` — `clearTimeout`
był po `return`, czyli nieosiągalny, a intencja (coalescing resize'ów do PTY na
50 ms) nie działała. **Fix B:** rozdzielone instrukcje = debounce działa jak
w założeniu: burza callbacków ResizeObserver (drag okna, drag krawędzi pane,
maximize) daje **jeden** resize 50 ms po ustaniu layoutu. Każdy resize wymusza
pełny repaint ConPTY, a repaint ścigający się z reflow xterm to właśnie rozmazane
stare klatki — mniej, późniejszych resize'ów zamiast jednego na klatkę.

**Root cause C — pane poniżej flooru pokazywał obcięty stary frame:** guard
`paneUnderMin` zatrzymuje *produkcję* śmieci (PTY nie schodzi do 2 kolumn), ale
canvas terminala zostawał w poprzednim rozmiarze i po obcięciu przez
`.pane { overflow: hidden }` wyglądał jak korupcja (m.in. zrzut użytkownika
z cienkim pasem). **Fix C:** stan `tooSmall` z ResizeObservera → klasa
`.xterm-host.too-small` chowa `.xterm` (`visibility: hidden`, więc rozmiar boxu
nie zmienia się i RO nie wpada w pętlę) + hint „okno za małe dla terminala —
powiększ”; po powiększeniu RO przywraca fit i PTY sam dostraja rozmiar.

**Hardening D — minimize/przywróć:** xterm nie słucha `visibilitychange`
(0 wystąpień w `xterm.js`), a jego `RenderService` repaintuje po powrocie tylko
gdy coś zgłosiło refresh w trakcie pauzy. Na `visibilitychange` w TerminalPane
leci `term.refresh(0, rows-1)` — pełny repaint z własnego bufora xterm, bez
reflow i bez wycieczki do PTY.

**Czego nie dało się dowieść bez GUI:** A i B są dowiedzione z kodu (B wprost —
nieosiągalna instrukcja), C z mechaniki CSS/ConPTY, D z braku `visibilitychange`
w xterm. Weryfikacja wzrokowa po `2 - pqTERM DEV` (albo `npm run dev`): start,
max/min/przywróć, przeciągnięcie krawędzi pane, zoom, przełączenie workspace'u —
panel ma wyglądać jak `cmd.exe` przy dowolnym z tych zdarzeń.

**Otwarte (ten sam defekt, inna powierzchnia):** nadal brak `resize` w ścieżce
`src/phone` (osobny wpis niżej, bez zmian).

### Bramki i dostawa (2026-09-24)

- `dev`: `npm run test:unit` **126 PASS** (w tym nowy test alertów; oba typechecki),
  `npm run check:version` OK (product 1.3.7; 2 locki, cargo), `npm run build` PASS.
- `test`: to samo na zmergowanym `dev` — **126 PASS**, check:version OK, build PASS.
- Commity na `dev` (fast-forward na `test`): `e5aa05b` (alerty), `f9be7cd`
  (geometria terminali), `10a4b9f` (logo/ikony), `8ae140f` + ten wpis (board).
  `dev` = `test`; `main` celowo nietknięty (promocja do oficjalnej to decyzja człowieka).
- Weryfikacja wzrokowa przez `2 - pqTERM dev` / `START-dev.cmd`: start, max/min/przywróć,
  zoom, przeciągnięcie krawędzi pane, przełączenie workspace'u + brak toasta
  „czeka na Ciebie” dla nietkniętych okien. To jedyny krok, którego bramki nie łapią.

### Skróty na pulpicie: dopiski pr/dev/test + nowa ikona (2026-09-24, druga runda)

**Zgłoszenie:** na pulpicie cztery ikony z atomem Electrona; „te ikony też zmienią logo?
zrób tym ikonom dopiski pr, dev, test”.

**Root cause atomu:** `make-shortcuts.cjs` ustawiał `IconLocation = host\pqterm.exe,0`,
którzy ten exe nigdy nie miał ikony (`stamp-host.cjs` ustawiał tylko wersje), więc
Explorer pokazywał ikonę Electrona. Fix: `IconLocation` wskazuje wprost
`<stable>\resources\brand\pq.ico` — ikona skrótu nie zależy już od tego, czy stamp się
udał, a to istotne, bo `host\pqterm.exe` jest regularnie zablokowany przez działającą
instancję (`EBUSY`, ten sam problem co przy 1.3.5). `stamp-host.cjs --set-icon` z
poprzedniego commita stempluje ikonę także w sam binarny.

**Nazwy:** `1 - pqTERM pr`, `2 - pqTERM dev`, `3 - pqTERM test` (numeracja zostaje —
kolejność na pulpicie); stare `Oficjalna` / `DEV` / `TEST` oraz duplikat
`Oficjalna (START-pr)` są kasowane przy każdym uruchomieniu skryptu.

**Znalezione przy weryfikacji, nie w kodzie (dwa defekty):**
1. Skrypt wstawiał ścieżki do PowerShella przez `JSON.stringify`, co dawało
   `C:\\Users\\...` — PowerShell nie escapuje backslashy, więc każdy `.lnk` niósł
   podwojone separatory (Windows to toleruje, dlatego nikt tego nie widział).
   Teraz literały w apostrofach (`psQuote`).
2. Wpis czyszczący legacy miał literówkę `Oficialna` (zamiast `Oficjalna`), przez co
   duplikat „Oficjalna (START-pr)” przeżywał czyszczenie. Poprawione.

**Dowód:** odczyt `.lnk` przez `WScript.Shell` po uruchomieniu skryptu — trzy skróty,
`target` z pojedynczymi separatorami, `icon=C:\Users\pq\pqTERM\resources\brand\pq.ico,0`,
`Test-Path` tej ikony `True`. Skrypt odpalony na `main` po promocji.

**Otwarte (wymaga zamknięcia aplikacji):** `host\pqterm.exe` w stable **nie** został
przestemplowany — `rcedit` zwraca EBUSY, bo działa instancja pqTERM. Sama ikona pliku
`.exe` w Explorerze zostanie stara do `npm run stamp` po zamknięciu pqTERM; ikona okna,
paska zadań i skrótów jest już nowa (pochodzi z `pq.ico`).

## Release 1.3.7 — update CLIs (2026-09-23)

- Produkt 1.3.6 → 1.3.7. Jedyna zmiana względem 1.3.6: `803958b` — przycisk ↻
  to "update CLIs", aktualizuje wyłącznie zainstalowane silniki (filtr
  `installed(spec)` w `sync.start()`); `ensure()` nadal instaluje przy spawn pane.
- Bramki na `dev` i `test`: 125 PASS, oba typechecki, check:version (product
  1.3.7; 2 locki, cargo), `npm run build` PASS.

## "Sync engines" → "Update CLIs": tylko zainstalowane (2026-09-23)

- **Problem (zględu użytkownika):** przycisk ↻ „sync engines” instalował WSZYSTKIE
  silniki ze specyfikacji, także te, których user nigdy nie chciał (npm install -g
  kilkunastu pakietów naraz). Update powinien dotykać tylko to, co już jest.
- **Fix** (`src/main/sync.ts`): `start()` filtruje kolejność do silników z
  `installed(spec)` (ten sam predykat `knownLaunch`, którego używa providers-scan).
  `ensure(id)` zostaje bez zmian — przy spawn pane nadal doinstalowuje brakujące,
  bo pane musi dostać działający binarny (to ścieżka "użytkownik poprosił").
- **Nazewnictwo:** tooltip docka → "update CLIs — aktualizuje tylko zainstalowane
  silniki", status line `pq · update CLIs…` / `pq · update done N/N`.
  IPC `sync:*` i klasa `EngineSync` bez zmian (internalne nazwy, nie warto renamować).
- Bramki: 125 PASS + oba typechecki na `dev`.

## Release 1.3.6 — stage-bar wolny, edycja workspace, floor geometrii, powiadomienia (2026-09-23)

- Produkt 1.3.5 → 1.3.6. W releasie trzy feature commity:
  `0519e2d`/`9c47b5f` stage-bar usunięty (zoom-strip tylko przy zoomie), zębatka ⚙
  + dwuklik = EDIT WORKSPACE (nazwa/katalog/grid 1–9); `6fcec31` floor geometrii
  20×8 po obu stronach (koniec "pionowej zupy liter" w małych pane); `b2a1095`
  powiadomienia dla każdego CLI (OSC 9/777 + waiting po 60 s ciszy).
- Bramki: `npm run test:unit` **125 PASS** + oba typechecki + `check:version`
  (product 1.3.6; 2 locki, cargo) + `npm run build` PASS na `dev`.
- Bump w 10 plikach: package.json(+lock 2 pola), crates/Cargo.toml, pq-core/version.rs,
  crates/Cargo.lock (pq-core, pq-voice, pq-work), src-tauri/Cargo.toml+lock (pq),
  tauri.conf.json, stamp-host.cjs, README. Guard zielony.

## Powiadomienia od każdego CLI — OSC 9/777 + heurystyka "czeka na Ciebie" (2026-09-23)

**Problem:** OMP dzwoni BEL-em przy końcu pracy → pqTERM pokazywał powiadomienie
(BEL = attention w `pane-activity.ts`). freebuff (i większość CLI) nigdy nie wysyła
BEL — user nie dostawał nic. `activity.signal()` (warstwa semantyczna) nie miała
żadnego wywołania w produkcie — martwy kod do tej pory.

**Fix — trzy kanały, zero integracji per-CLI:**
1. **OSC 9 / OSC 777** (`src/main/osc-notify.ts`): skan strumienia PTY pod kątem
   standardowych sekwencji powiadomień (iTerm2 `ESC]9;<body>BEL/ST`, rxvt
   `ESC]777;notify;<title>;<body>BEL/ST`) — odporny na cięcie między chunkami
   (tail jak w `osc-title.ts`, cap 2048 B). CLI, które "prosi" o powiadomienie,
   dostaje toast natychmiast (`onNotice` w `pty-manager` → `index.ts`), pod tymi
   samymi strażami co BEL (settings, focus, Notification.isSupported), z kliknięciem
   do pane.
2. **"Czeka na Ciebie" z ciszy** (`pane-activity.ts`): running → quiet po 30 s
   (status, bez alertu, jak było) → **waiting po 60 s ciszy = alert raz na stretch**.
   Output resetuje stretch. To działa dla KAŻDEGO CLI, które po pracy po prostu
   przestaje pisać (freebuff włącznie) — nie wymaga żadnego wsparcia z jego strony.
3. **BEL / wyjście procesu** — bez zmian (attention / exited / error).

Testy: `osc-notify.test.ts` (7: BEL+ST, 777, nie-łamania na OSC 0/2, split-chunk,
multi, patologia, cleaner) + `pane-activity.test.ts` +1 (stretch: raz, reset,
nowy stretch). Bramki: **125 PASS** + oba typechecki na `dev`.

## „Pionowa zupa liter” — floor geometrii 20×8 po obu stronach (2026-09-23)

**Symptom (zrzuty):** w małych pane gęstych siatek TUI zamienia się w pionowy sznur
pojedynczych liter; po powiększeniu pane ramka wraca, ale momentami zostają przesunięcia.

**Root cause:** `fit()` w `TerminalPane` nie miał dolnego limitu — pane ~200×100 px po
odjęciu paddingu proponuje ConPTY geometrię 2–3 kolumny. Renderer wysyłał ją bez clampu,
main przyjął (`Math.max(1, …)` od 1.3.5), ConPTY zrobił reflow bufora do 2 kolumn i
przemalował ekran jako jedną literę na wiersz. To nie ten sam bug co w 1.3.5 (tam PTY
stał w 80×24 mimo innego xterm); tu PTY słusznie stoi tam, gdzie kazano — tylko
kazano mu bezsensu.

**Fix — jedna stała, dwie strony (`src/shared/term-geometry.ts`):**
1. `PTY_MIN_COLS=20 / PTY_MIN_ROWS=8` (te same liczby co dotychczasowy clamp spawnu):
   `pty-manager.ts` przy spawnie **i** przy resize nie zejdzie poniżej flooru.
2. `MIN_PANE_W=190 / MIN_PANE_H=92` + `paneUnderMin()`: `TerminalPane` nie wykonuje
   `fit()`/`sendResize` dla pane poniżej flooru (ResizeObserver, efekt zoom/focus
   **i pierwszy fit w `start()`**) — terminal trzyma ostatni dobry rozmiar i refituje
   w momencie, gdy pane urośnie (ResizeObserver to załatwia).
3. Re-eksport przez `grid.ts` (z jawnym `.ts`, wymagane przez strip-types); tsconfigi
   dostawiły `allowImportingTsExtensions`.
4. Testy `src/shared/term-geometry.test.ts` (3): floor pane mieści floor PTY,
   `paneUnderMin` na granicy, zgodność liczbową z historycznym clampem.
- Bramki: `npm run test:unit` **117 PASS** + oba typechecki na `dev`.
- Otwarte: ten sam floor dla `src/phone` (zdalny widok nie wysyła rozmiaru — bez zmiany).

## Stage-bar usunięty w całości, zębatka edycji w sidebarze (2026-09-23)

- **Stage-bar nie istnieje.** Po zdjęciu steppera/1-9/fill/broadcast (poprzedni wpis)
  został i pasek jako taki: badge `▦ N`, ścieżka cwd, `.grow`. Teraz zniknęło wszystko —
  grid CLI zyskał ~34 px wysokości na stałe. Jeden exception: **zoom-strip** (tylko
  przy powiększonym pane) wyprowadzony z `.pane-strip` + `.stage-bar` do nowego
  `.zoom-strip` — pokazuje się wyłącznie w trybie zoom.
- **Zębatka `⚙` na każdym wierszu workspace w sidebarze** (`onEdit(w.id)`) — widoczna
  na hover/focus-within (wzór z `.side-remove`), hover zielony nie czerwony. Otwiera
  ten sam EDIT WORKSPACE co dwuklik; dwuklik dalej działa.
- Zapytanie użytkownika „zabrałeś wszystko do wyboru CLI?” — tak, celowo: zmiana grida
  to operacja konfiguracyjna (raz na jakiś czas), nie ciągła; sterowanie
  silnikami w pane pozostaje w TerminalPane. Skrót `ctrl+shift+R` nietknięty.
- Bramki: 114 PASS + oba typechecki na `dev`; commit `9c47b5f`.

## Stage-bar: grid-switch do modala, edycja workspace (2026-09-23)

- **Co zniknęło z stage-bara:** stepper `− 1 +`, przyciski `1..9`, `fill rest`, input
  broadcast — pasek zostaje z badge `▦ N`, ścieżką cwd i pane-strip przy zoomie.
- **Badge `▦ N`** = liczba okien aktywnego workspace; klik otwiera **EDIT WORKSPACE**
  (ten sam `NewWorkspaceModal`, nowy props `workspace`).
- **EDIT WORKSPACE:** tytuł + katalog przez istniejące `workspaces:update`, grid przez
  istniejące `workspaces:setLayout`. Zmniejszenie grida poniżej liczby żywych sesji
  pyta `window.confirm` (setLayout i tak ubija nadmiarowe PTY-je — confirm tylko ostrzega).
- **Sidebar:** dwuklik na wierszu workspace → ten sam modal edycji (`onEdit(w.id)`);
  pojedynczy klik dalej tylko otwiera. Dwuklik na przyciskach wiersza (chev/remove/folder)
  nie otwiera modala.
- Skrót `ctrl+shift+R` (fill rest) zostaje — zniknął tylko przycisk; input broadcast
  nie miał skrótu i został zdjęty (silnik startowy i prompt dalej są w TerminalPane).
- Zero nowych kanałów IPC. Bramki: `npm run test:unit` **114 PASS** + oba typechecki na `dev`.

## Release 1.3.5 — CLI screen scale (2026-09-22)

- Produkt 1.3.4 → 1.3.5; 17 plików w commicie `6e5eba8` (fix + bump).
- Bramki na `dev` i na `test`: `npm run test:unit` **114 PASS** (oba typechecki),
  `npm run check:version` OK (`product 1.3.5; 2 locki, cargo`), `npm run build` PASS.
- `dev` = `test` = `main` = `6e5eba8`; zdalnie `origin/dev|test|main` = `6e5eba8`
  (fast-forward `2e4ad86..6e5eba8`).
- Zdalne commity `b7afec2` (build `out/` na postinstall) i `2e4ad86` (seeds w plikach
  instrukcji agentów) zintegrowane **rebasem** — bez konfliktu. Lokalne `AGENTS.md`,
  `CLAUDE.md`, `CONVENTIONS.md`, `GEMINI.md` i `.github/copilot-instructions.md` były
  bajt w bajt identyczne z `2e4ad86`, więc przed FF poszły na `stash@{0}` jako backup
  (można go zrzucić — nic unikalnego nie trzyma).
- `host\pqterm.exe` **nie został zestampowany**: plik zwraca `EBUSY`, bo trzyma go
  działająca instancja pqTERM. Po jej zamknięciu: `node scripts/stamp-host.cjs`
  (ProductVersion → 1.3.5; FileVersion zostaje 1.1.7 z założenia).
- Oficjalne `out/` przebudowane w `C:\Users\pq\pqTERM` (`npm run build`) — build z 1.3.5.
- `instances/wip` (gałąź `main`, cudzy staged index) i `instances/feat/engine-lifecycle`
  nietknięte; `wip` widzi teraz nowy HEAD `main`, jego bajty w indexie zostały nienaruszone.


## CLI nie może się „krzaczyć” — audyt pipeline'u xterm ↔ ConPTY (2026-09-22)

**Symptom:** TUI (freebuff i inne CLI) potrafi pokazać poszatkowany ekran — fragmenty starych
klatek rozsypane po całej szerokości, pojedyncze znaki w skrajnej lewej kolumnie na kolejnych
wierszach, logo w połowie ekranu. Wymaganie: po zmniejszeniu / powiększeniu / minimalizacji /
maksymalizacji zawsze wygląda jak w `cmd.exe`.

**Root cause (z kodu, każdy punkt ma linijkę):**

1. **Kłamstwo o rozmiarze PTY** (naprawione): `TerminalPane` po `spawn` ustawiał
   `lastSentSizeRef = {term.cols, term.rows}`, czyli „PTY stoi tam, gdzie `fit()`”. PTY stoi
   jednak tam, gdzie je postawiono: `restoreSession` spawnuje na sztywno **80×24**, a seed
   scrollbacku zgłaszał własną, starą geometrię (`capCols = seedCols`). Dedupe w `sendResize`
   uznawał resize za zbędny → **PTY nigdy nie dostał realnego rozmiaru, ConPTY nie zrobił
   repaintu**, a xterm po `term.resize(replayCols)` → `fit()` zostawał ze zreflowaną,
   posklejaną klatką (reflow xterm na strumieniu ConPTY, bez markerów zawijania, skleja
   wiersze wg heurystyki „ostatni znak ≠ spacja ⇒ zawinięte”). To jest obraz z rzutu ekranu.
2. **Cichy clamp ≥20×8 w mainie** (naprawione): renderer o nim nie wiedział, a jego dedupe
   nigdy nie wysłał realnego rozmiaru → CLI pisało na 20 kolumn do 12-kolumnowego xterm (stąd
   znaki zsuwające się po lewej kolumnie).
3. **Trim bufora 512 kB ciął w środku sekwencji ANSI** (naprawione): replay zaczynał się
   połową CSI, która zjadała kolejne bajty. Teraz cięcie przechodzi za ostatni bajt sekwencji
   (`src/shared/term-stream.ts` + 7 testów).
4. **`pending.shift()` po 500 chunkach przy attachu** (naprawione): dziura w strumieniu = raz
   rozcięta sekwencja między dwoma chunkami; zamiast dropować, widok dociąga cały bufor z maina
   (`term:buffer`, nowy kanał read-only z `requireRenderer` + capem długości).
5. **`ESC[2J` bez `ESC[H`** (naprawione): repaint ConPTY lądował przesunięty o pozycję kursora.

**Research:** wez (autor wezterm, wezterm#3363) — jedynym pełnym lekarstwem na wyścig
resize↔repaint jest debounce resize'u do PTY, a ConPTY potrafi sam „syntetyzować” pełny repaint
ekranu; xterm `IWindowsPty` (`xterm.d.ts:294-310`) — reflow jest poprawny tylko dla
`conpty && buildNumber ≥ 21376`. Host ma `10.0.26200`, a brak `buildNumber` w xterm 5.5 wpada w
gałąź `_hasScrollback && !windowsMode` = **reflow on**, czyli już zgodnie z nowoczesnym ConPTY —
świadomie nie zmieniano (żadnego zysku, nowy kanał IPC bez potrzeby).

**Zmiany (dev):** `src/main/pty-manager.ts` (`capCols/capRows` = rozmiar PTY, nie seeda; `resize`
bez clampu 20/8; trim przez `appendTail`), `src/main/index.ts` (zniknął sidecar `*.json` z
geometrią seeda; nowy `term:buffer`), `src/preload/index.ts` (+`terminals.buffer`),
`src/renderer/src/components/TerminalPane.tsx` (rozmiar PTY z raportu spawnu, `ESC[2J`+`ESC[H`,
resync zamiast dropu, marker `ponytail:` o cieciu seeda).

**Weryfikacja na żywo (CDP, `REMOTE_DEBUGGING_PORT=9333`):** electron-vite czyta tę zmienną
środowiskową i dokłada `--remote-debugging-port`, więc instancję dev dało się sondować przez
`Runtime.evaluate`. Sonda porównywała `terminals.buffer(paneId).cols/rows` (rozmiar PTY)
z liczbą wierszy DOM xterm oraz szerokością `.xterm-screen` podzieloną przez szerokość znaku,
w krokach: layout 6 → 3 → powrót, zoom on/off, maksymalizacja, minimalizacja, przywrócenie,
burza resize'ów, przełączenie workspace. **Wiersze zgadzały się co do jednego w każdym kroku**
(33/33, 69/69, 33/33…). Kolumny wychodziły ~2% wyżej od rozmiaru PTY (145 vs 142, 95 vs 93,
294 vs 289) — to mieści się w błędzie pomiaru szerokości znaku sondą (span w czcionce xterm
vs własny pomiar xterm), ale **nie rozstrzygnięto tego do końca**. Sesja dev padła w połowie
(proces odpalony z shella tego narzędzia), więc przebieg nie został dokończony: werdykt
zostaje **WARUNKOWO OK**, nie PASS. Użytkownik ocenił wynik wizualnie jako „idealnie”.

**Bramki:** `npm run test:unit` = oba typechecki + **114 PASS** (w tym 7 nowych);
`npm run check:version` OK po bumpie produktu **1.3.4 → 1.3.5**; `npm run build` PASS.

**OPEN (ten sam defekt, inna powierzchnia):** `src/phone/src/App.tsx` montuje xterm w rozmiarze
telefonu i **nigdy nie wysyła rozmiaru do PTY** (brak `resize` w `client.ts` i w `remote.ts`), więc
na telefonie CLI pisze na szerokość desktopu i zawija się na ekranie telefonu. Naprawa wymaga
nowej wiadomości WS + walidacji w `remote.ts` (granica zaufania) — do zrobienia świadomie, nie
przy okazji.

## Sidebar — przeciąganie workspaces (2026-09-18)

- HTML5 drag na kartach w `Sidebar.tsx`: drop before/after (zielona kreska). Kolejność = tablica `state.workspaces`, zapis przez istniejący `persist()` → `pq-state.json`.
- IPC `workspaces:reorder` (walidacja: 1–64 stringów ≤128). Czysta logika: `src/shared/order.ts` + `order.test.ts`. Szukanie wyłącza drag (przefiltrowana lista ≠ pełna).
- Bez nowej zależności. Telefon bez reorder (YAGNI).

## Workspace defaults — ponytail + i-have-adhd (2026-09-18)

- `trustWorkspace` (każdy spawn CLI) i `workspaces:create` dopisują blok `<!-- pq:defaults -->` do `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `CONVENTIONS.md`, `.github/copilot-instructions.md`. Idempotentne. Pomija homedir / Windows / Program Files.
- Bez kopiowania `.agents/skills`. Inline standing orders dla omp/grok/claude/gemini/codex/opencode/copilot/aider.

## Release 1.3.0 — CLI defaults everywhere (2026-09-18)

- Product 1.2.1 → 1.3.0. Seed ponytail + i-have-adhd into every workspace CLI instruction file. FileVersion stays 1.1.7.

## Release 1.3.1 — equal 5–8 grids (2026-09-18)

- Product 1.3.0 → 1.3.1. Grid 8=4×2, 7=4+3, 6=3×2, 5=3+2; independent pane-edge resize. FileVersion stays 1.1.7.

## Release 1.3.2 — terminal http(s) links (2026-09-18)

- Product 1.3.1 → 1.3.2. Open terminal URLs in the browser instead of `about:blank`. FileVersion stays 1.1.7.

## Release 1.3.3 — Hermes spawn like CMD (2026-09-18)

- Product 1.3.2 → 1.3.3. SPAWN ENGINE runs bare `hermes` (not `--tui` dashboard). FileVersion stays 1.1.7.







## Release 1.2.1 — drag-reorder workspaces (2026-09-18)

- Product 1.2.0 → 1.2.1 (`package.json`, lock, crates, src-tauri, stamp-host ProductVersion, README). FileVersion stays 1.1.7.
- Feature already on main (`b9cbd0e`). This stamp ships it.


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
