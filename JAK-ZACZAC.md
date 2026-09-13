# pq — instrukcja dla totalnego laika

## Obrazek do zapamiętania: masz 3 rzeczy

1. **pq-prod (Twoje biurko)** — normalne okno pq, Twoje workspace'y, Twoja praca.
   Otwierasz: dwuklik `host\pq.exe` albo skrót `pq-prod` z pulpitu.
2. **pq-dev (piaskownica)** — drugie, identycznie wyglądające okno do TESTÓW.
   Otwierasz: skrót `pq-dev` z pulpitu albo plik `START-dev.cmd`.
   Możesz je psuć i zamykać — biurku nic się nie stanie.
3. **Osobny pokój na remont** — kiedy chcesz coś ZMIENIĆ w samym pq,
   remont robisz nie na biurku, tylko w osobnym pokoiku (folderze).
   Pokoik robi się jedną komendą (patrz scenariusz B).

## Scenariusz A: po prostu pracujesz

Kliknij pq-prod. Koniec. Nic się nie zmieniło.

## Scenariusz B: chcesz coś zmienić w pq (krok po kroku)

**Krok 1 — otwórz czarne okienko z komendami:**
Otwórz folder `C:\Users\pq\pq`, kliknij pasek adresu u góry,
wpisz `powershell`, naciśnij Enter.

**Krok 2 — zrób osobny pokoik (wklej to i Enter):**
```
node scripts/new-work.cjs create moj-pomysl
```
(Pisz małymi literami, bez polskich znaków, zamiast spacji myślnik.)

**Krok 3 — otwórz ten pokoik w pq:**
W pq-prod kliknij domek ⌂ (lewy pasek) → `+ new` →
TYTUŁ: `moj-pomysl`, KATALOG: `C:\Users\pq\pq-trees\moj-pomysl` → `create`.
Masz workspace. W pustym okienku odpal agenta (np. OpenCode).

**Krok 4 — powiedz agentowi, co ma zrobić** — normalnymi słowami,
np. „dodaj przycisk, który robi X". Agent grzebie TYLKO w pokoiku.

**Krok 5 — sprawdź:** otwórz pq-dev (piaskownica) i zobacz, czy działa.
Jak coś sypie błędami — nic strasznego, to jest okno do psucia.

**Krok 6 — powiedz mi: „włącz to do głównej".**
Ja sprawdzę zmiany, włączę je i posprzątam pokoik. Ty nie musisz
rozumieć, co dzieje się pod spodem.

## Scenariusz C: coś się zepsuło / pogubiłeś się

1. Zamknij pq-dev. Twoje biurko (pq-prod) jest całe.
2. Nieudany pokoik usuń komendą:
   ```
   node scripts/new-work.cjs remove moj-pomysl
   ```
3. Napisz do mnie, co widziałeś — naprawię.

## Słowniczek (3 słowa, więcej nie trzeba)

- **pokój / worktree** — osobna kopia projektu do jednego remontu.
- **włączenie / merge** — przeniesienie udanego remontu do głównej wersji (robię ja).
- **testy** — automatyczna kontrola „czy nic się nie sypie" (odpalam ja).

## Czego NIGDY nie klikaj sam

- `npm run dist` (robi instalator — tylko na wyraźną prośbę),
- nie kasuj ręcznie folderów w `C:\Users\pq\pq` ani w `%AppData%`.
