# pq

Siatka terminali dla agentów AI na Windows. Workspace’y po lewej, 1–9 żywych TUI po prawej.

Na razie **prywatne**. Publicznie wyjdzie dopiero gdy zdecydujesz.

## Dwa środowiska

| | **pq-dev** | **pq** |
|---|---|---|
| start | `npm run dev` | installer z GitHub Release |
| dane | `%AppData%\pq-dev` | `%AppData%\pq` |
| po co | łamiesz produkt | codziennie odpalasz agentów |

Nie commituj z katalogu, z którego leci akurat `npm run dev` w tym samym drzewie co agenty — trzymaj **klon gita** jako cwd workspace’u.

## Nowy komputer (to Cię za chwilę czeka)

1. Zainstaluj [Node.js LTS](https://nodejs.org/) i [Git](https://git-scm.com/).
2. Zaloguj się do GitHuba (`gh auth login` albo Git Credential Manager przy `git clone`).
3. Sklonuj **private** repo:

```bat
git clone https://github.com/TWOJ_LOGIN/pq.git
cd pq
npm install
npm run rebuild
npm run dev
```

4. Zaloguj się w aplikacji (Google). Workspace’y i logowanie **nie** jadą w gicie — są w `%AppData%\pq-dev`. Na nowym PC logujesz się od nowa i wskazujesz foldery projektów.

## Start tutaj

```bat
cd %USERPROFILE%\pq
npm install
npm run rebuild
npm run dev
```

## Koordynacja agentów

W cwd workspace’u: `.pq/BOARD.md`. Agenty mają czytać tablicę zanim wejdą w te same pliki.
