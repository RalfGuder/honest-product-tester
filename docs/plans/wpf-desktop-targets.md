# Plan: WPF-Desktop-Apps als Testziel

## Context

honest-product-tester lässt Persona-Agenten heute nur Websites testen: Pi-Agent (`@mariozechner/pi-coding-agent`) + `agent-browser` CLI, Ziel = eine URL (`RunManifest.url`), Tools `browser_*`, Login/Assertions DOM-basiert. Ziel: dieselben Personas und Szenarien auch gegen Windows-Desktop-Apps (WPF/WinForms/Win32) laufen lassen. Backend: `agent-wpf` CLI (v0.1.0, gleiches Snapshot/Ref-Modell wie agent-browser: `open`, `snapshot -i`, `@eN`, `click/fill/select/press/scroll/table/screenshot/wait`, `--session`, `--json`, Exit-Codes 0–6).

## Entscheidungen (Grilling 2026-10-03)

| # | Thema | Entscheidung |
|---|---|---|
| 1 | Backend | `agent-wpf` CLI als Child-Process, analog `runAgentBrowser` |
| 2 | Ziel-Modell | `RunManifest.target: {kind:'web', url} \| {kind:'desktop', appId, exePath, args?, workingDir?}`; alte Manifeste mit `url` beim Lesen → `kind:'web'` |
| 3 | Lifecycle | Frische App-Instanz pro Cell: `--session <runId>-<cellId> open <exe>`, Ende `close --kill` (im `finally`) |
| 4 | Parallelität | Desktop default `maxParallel=1`, im Run-Formular erhöhbar |
| 5 | Echte Maus/Tastatur | `--input`/`press`/`type` nur bei `maxParallel=1`, sonst Tool-Fehler „real input disabled" |
| 6 | Tools | Eigenes `desktop_*`-Set. Aktionen (Budget): click, fill, select, check/uncheck, expand/collapse, press, scroll, wait, switch_window. Freie Reads: snapshot, screenshot, windows, table, get_value. Kein open/close/attach für Agent |
| 7 | Szenario-Bindung | Frontmatter `target_app` (appId) + `start_args`; `target_host`/`start_path` bleiben Web. Szenario: host xor app xor keins |
| 8 | Assertions | `text_visible` (Desktop: `snapshot --all-windows`, Suche in Namen+Values) + neu `window_title_matches` (Regex). `url_contains` bei Desktop ausblenden / „not applicable" |
| 9 | Login | Skriptiert durch Executor vor Agent-Start; Passwort nie im Modell-Kontext |
| 10 | Credentials | `credentials.local.json` → `desktop: { "<appId>": { usernameField, passwordField, submit, loggedInWindow, personas{…} } }`; Web-Block unverändert |
| 11 | Exe-Quelle | Allowlist `desktop-apps.local.json` (id, name, exePath, defaultArgs, workingDir) + `desktop-apps.example.json`; Run-Form Dropdown, kein Freitext-Pfad |
| 12 | Identität | `appId` überall (Szenario, Credentials, Manifest) |
| 13 | Binary | `AGENT_WPF_BIN` env, Fallback PATH; Preflight `--version` bei Run-Start; Desktop-Option nur auf win32 + Binary vorhanden |
| 14 | Personas | Bodies neutralisieren („website" → „product/app"); neue Builder `buildDesktopPersonaPrompt`/`buildDesktopMissionPrompt` |
| 15 | Architektur | `TargetDriver`-Interface; Schritt 1 behavior-neutraler Extract `drivers/web-driver.ts`, Schritt 2 `drivers/desktop-driver.ts` |
| 16 | Evidence | `CellEvidence.finalWindow` + `openWindows[]`; run-details zeigt je kind URL oder App+Fenster |
| 17 | Testziel | Demo-WPF-App `fixtures/desktop-demo/` (.NET: Login-Dialog, Formular, DataGrid, Bestätigungsdialog) |
| — | Default (nicht gegrillt) | App-Startzeit + Login zählen nicht gegen `CELL_TIMEOUT_MS`; Idle-Watchdog/Step-Budget/Report unverändert |

## Umsetzungsschritte

### Phase 1 — Refactor (behavior-neutral)
- `src/lib/drivers/types.ts`: `TargetDriver { start, login, createTools(runTool), checkAssertions, captureFinal, evidence, close, maxParallel }`.
- Web-Code aus `src/lib/run-executor.ts` verschieben: `createBrowserTools` (:641), `runAgentBrowser`/`AGENT_BROWSER_BIN` (:64, :1160), `loginPersona`/`verifyLogin` (:1228–1431), `checkAssertions`/`readCurrentUrl`/`captureFinalScreenshot` (:552–611), Prompt-Builder (:903, :952) → `drivers/web-driver.ts`.
- Generisch im Executor lassen: Pi-Session (:223), `runTool` (:657), Step-/Time-Budget, `idle-watchdog.ts`, `report-parsing.ts`, `scenario-verdict.ts`, Cell-Storage.
- Concurrency-Schleife (:120) nutzt `driver.maxParallel` (Web: unbegrenzt = heutiges Verhalten).
- Commit erst, wenn `vitest` grün und Web-Run manuell unverändert.

### Phase 2 — Datenmodell
- `src/lib/runs.ts`: `target`-Union, Lese-Migration `url` → `{kind:'web'}`, `validatePublicUrl` nur für web; neues `validateDesktopTarget` gegen Allowlist.
- `src/lib/desktop-apps.ts` (neu): Allowlist laden (`HPT_DESKTOP_APPS_FILE` override analog `HPT_CREDENTIALS_FILE`).
- `src/lib/scenario-model.ts` / `scenario-format.ts`: `targetApp`, `startArgs`, Assertion-Typ `window_title_matches`; `matchesTarget(scenario, target)` ersetzt/ergänzt `matchesTargetHost`.
- `src/lib/credentials.ts`: `desktop`-Block pro appId, gleiche Unique-Username-Prüfung.
- `src/lib/scenario-verdict.ts`: `CellEvidence.finalWindow?`, `openWindows?`.

### Phase 3 — Desktop-Driver
- `src/lib/drivers/desktop-driver.ts`: `runAgentWpf(args, {session, json:true})` (Spawn wie `runAgentBrowser`, `windowsHide`, Timeout, Exit-Code → Fehlertext mit `hint`).
- Binary-Auflösung + Preflight (`AGENT_WPF_BIN` → PATH).
- `start`: `open <exePath> -- <defaultArgs> <startArgs>` mit `cwd=workingDir`.
- `login`: fill/click per Selektor, `wait --window <loggedInWindow>`; Passwort per Argument nur an CLI, nie geloggt (prüfen, ob agent-wpf stdin-Variante hat; sonst Logging-Redaction sicherstellen).
- `desktop_*`-Tools über generischen `runTool`; Snapshot/Table-Ausgaben truncaten (Limit für Snapshot größer als 280 Zeichen nötig — wie heute `browser_snapshot`).
- Real-Input-Gate an `maxParallel`.
- Screenshots: `agent-wpf screenshot <data/runs/<id>/screenshots/...png>` → gleiche Ablage/Route wie Web.
- Assertions: `text_visible` via `snapshot --all-windows --json`, `window_title_matches` via `windows --json`.
- Evidence: `windows --json` → `finalWindow`, `openWindows`.

### Phase 4 — UI + Texte
- `src/app/run-form.tsx`: Umschalter Web/Desktop; Desktop: App-Dropdown, `maxParallel`; Szenario-Sortierung nach `matchesTarget`.
- `src/app/scenarios/scenario-form.tsx`: Typ-Umschalter, `targetApp`-Dropdown, `startArgs`, Assertion `window_title_matches`, `url_contains` bei Desktop ausblenden.
- `src/app/runs/[runId]/run-details.tsx`: Ziel + Evidence je kind.
- `src/i18n/dictionaries/de.ts` + `en.ts`: alle neuen Strings; „Max browser actions" → neutral.
- `personas/*.md` neutralisieren.

### Phase 5 — Demo-App + Doku
- `fixtures/desktop-demo/` (.NET WPF, AutomationIds gesetzt), Build-Anleitung.
- `desktop-apps.example.json`, `credentials.example.json` um Desktop-Beispiel erweitern.
- README: Desktop-Abschnitt (agent-wpf installieren, env-Var, Allowlist).

## Verifikation
- `npx vitest run`: neue Tests für Manifest-Migration, Allowlist-Validierung, Szenario-Frontmatter-Roundtrip (`target_app`, `start_args`, `window_title_matches`), agent-wpf-JSON-Parsing, Assertion-Auswertung, Real-Input-Gate.
- Nach Phase 1: Web-Run gegen bekannte URL, Ergebnis-Struktur identisch zu vorher.
- E2E: Demo-App bauen, in Allowlist eintragen, Run mit 2 Personas × 2 Szenarien (eins mit Login, eins mit DataGrid-Lesen) → Screenshots, Verdicts, `finalWindow` in run-details prüfen; `maxParallel=2` → Real-Input-Tools liefern Fehler.
- Negativ: fehlendes Binary → klarer Preflight-Fehler; nicht gelisteter appId → Validierungsfehler.

## Offene Punkte
- agent-wpf v0.1.0: Passwort-Übergabe via stdin vorhanden? Sonst Redaction im Logging.
- Snapshot-Größe großer Apps vs. Token-Budget (ggf. `-d`/`-s` im Tool-Schema anbieten).
