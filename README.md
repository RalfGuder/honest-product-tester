# Real Feedback From Fake People

[![Product demo](./demo-preview.gif)](./demo.mp4)

> **Catch your AI slop before your customers do.** **Real Feedback** sends opinionated, autonomous AI personas to live-test your website. They either explore freely or work through test scenarios you define, using real browser automation, and turn first impressions into actionable feedback and honest pass/fail verdicts.

## ✨ The "Aha!" Moment
* **Parallel Agent Execution:** This isn't a mock. Every persona runs its own **Pi session** with its own browser instance and worldview; personas run in parallel.
* **Autonomous Tool Use:** We don't hardcode paths. Personas like *Dark Muckerberg* or *Chef Lamb Sauce* use a custom `agent-browser` toolset to click, type, scroll, look at screenshots and inspect the page based on their own goals.
* **Test Scenarios:** Give the personas a mission and a success criterion. Each one takes its own path and reports whether it made it, gave up or failed. A matrix shows which kind of user struggles where.
* **Live Voyeurism:** Watch the "Terminal of Truth" in real time. The UI streams the actions, observations and screenshots of the agents as they navigate your DOM.
* **German and English:** UI, persona profiles, live messages and the persona reports themselves.

## 🎭 The Testers
Our agents are loaded from Markdown-based persona definitions in `personas/`:
* **Dark Muckerberg:** Looking for data moats and optimization.
* **Cardi Confused:** If it’s not intuitive, she’s out.
* **Chef Lamb Sauce:** "It’s RAW!"—critiquing UI polish and performance.
* **Tom Thanks:** The nicest guy in tech, looking for the silver lining.
* **Sir Stack-Overflow:** Testing your technical edge cases.
* **Multitasking Millie:** Can your site hold attention?

## 🧠 How it Works (The Flow)
1.  **Start:** On the start page you enter a URL and pick the **testers**, the **scenarios** and the **report language**. Scenarios whose target host matches the URL are listed first; *Free exploration* is preselected.
2.  **Cell plan:** Every selected persona works through every selected scenario it is assigned to. Each persona × scenario pair is a **cell** with a fresh browser and Pi session (and its own login). A persona's scenarios run one after another; personas run in parallel.
3.  **The Agent Loop:** The persona gets its Markdown prompt plus either the free-exploration brief or the scenario mission, and browses with `agent-browser` tools (see below).
4.  **Limits:** A hard step budget per scenario, a cell timeout that grows with that budget (20 s per step, at least 10 minutes) and an idle watchdog that stops a session after 3 minutes without activity.
5.  **Verdict:** The persona reports in strict JSON. For scenarios, optional code-checked **assertions** (`url_contains`, `text_visible`) override the persona's own verdict, and a contradiction is flagged as *persona misjudged*. Invalid JSON gets one repair round; the raw answer is kept for debugging.
6.  **Results:** A verdict matrix (personas × scenarios, pass rate per scenario) above the persona cards. Free exploration shows four insights per persona; scenarios show verdict, steps, quote, friction points, evidence and assertions.

### Browser tools
| Tool | Purpose |
| --- | --- |
| `browser_open`, `browser_click`, `browser_type`, `browser_press`, `browser_wait` | Interact with the page (count against the step budget) |
| `browser_scroll` | Scrolls the page, or the largest visible scrollable area (e.g. a dialog) when the page cannot move; `withinText` targets a specific list; reports when the end is reached |
| `browser_snapshot` | Accessibility tree with element refs |
| `browser_screenshot` | Saves a screenshot and hands the image to the model |
| `browser_zoom` | Crops the area around a visible text and enlarges it 3x, for tiny details like status dots |
| `browser_inspect` | Sanitized markup around a visible text, for state the accessibility tree hides |
| `browser_get_title`, `browser_get_url` | Read page title / URL |

Reads (snapshot, screenshot, zoom, inspect, title, URL) are free; only the interacting tools count against the step budget.

## 🧪 Test Scenarios
Scenarios are managed in the UI under **`/scenarios`** and stored as Markdown files in `scenarios/<id>.md`, using the same front-matter pattern as the personas. The text below the front matter is the mission, addressed to the persona.

```md
---
id: save-favorite
title: Save a recipe as a favorite
success_criteria: The recipe appears in the favorites list
target_host: recipes.example.com   # optional: listed first for matching URLs
start_path: /recipes               # optional: relative to the run URL
login: auto                        # auto | required | anonymous
allow_submit: true                 # opt-in: persona may submit forms
max_steps: 25                      # hard step budget
personas:                          # optional: only these personas; empty = all
  - tom-thanks
assertions:                        # optional: checked by code after the run
  - type: url_contains
    value: /favorites
  - type: text_visible
    value: Saved
---
You want to find a recipe for dinner and save it for later.
```

* **Verdicts:** `passed`, `failed`, `gave_up` (the persona would realistically stop), `limit_reached` (step budget, timeout or idle stop), `error`, `skipped`.
* **Login:** `auto` logs in when the persona has credentials, `required` skips personas without credentials, `anonymous` never logs in.
* **Writing actions:** Without `allow_submit`, personas stop right before a final submit. With it, they may submit forms; purchases, payments, deleting data and account changes stay forbidden. **Use it only against staging or test environments.**
* **Free exploration** is a built-in pseudo scenario (`explore`) with the original four insight questions.
* Each run stores a snapshot of its scenarios, so later edits or deletions do not change past results.

## 🌍 Languages
* The UI language comes from the language switcher (saved in a cookie), otherwise from the browser's `Accept-Language`, otherwise English. Dictionaries live in `src/i18n/dictionaries/`; another language needs one more dictionary file and an entry in `src/i18n/config.ts`.
* The **report language** is chosen per run. Personas answer in it, and the report files are written in it; JSON keys and verdict values stay English.
* Persona profiles can carry translated display texts in a `locales.<lang>` block of their front matter. The agent prompt itself is never translated.

## 🛠️ The Tech Stack
* **Frontend:** `Next.js 16.2` • `React 19.2` • `Lucide React`
* **Agent Logic:** `Pi SDK` (Reasoning) • `agent-browser` (Execution) • `sharp` (zoom)
* **Data Layer:** Filesystem-backed persistence (JSON/MD/Screenshots)
* **Parsing:** `gray-matter` for persona and scenario definitions
* **Tests:** `Vitest` for the pure logic (scenario format, verdicts, parsing, i18n, tools)

## 🏁 Quick Start
* Make sure you have the Pi agent installed and are logged in with one of your accounts; the personas use it.

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # unit tests
```

## 🔐 Login per Persona
If the site under test needs a login, every persona logs in with its **own** account before it starts browsing. The model never sees the password.

1. Copy `credentials.example.json` to `credentials.local.json` (gitignored) or point `HPT_CREDENTIALS_FILE` at a file outside the repo.
2. Set `loginUrl` and one `username`/`password` per persona id. Usernames must be unique.
3. `basicAuth` is optional: set it when an HTTP Basic Auth gate (e.g. Caddy on staging) sits in front of the site. It is shared by all personas. The tester answers the gate from Node and passes only the gate cookies to the browser, so the app's own Bearer tokens are not overwritten.
4. The selector fields are optional; leave them out to let `agent-browser auth login` detect the form.
5. After submitting, the login is verified for about 8 seconds: the persona fails if the page stays on the login path, if a Blazor error banner (`#blazor-error-ui`) appears, or if the optional `loggedInSelector` is missing.

Without a credentials file, runs behave as before. A persona missing from the file fails with `No login configured for persona <id>`. Scenarios control whether a login happens at all (see `login` above).

## 📁 Run Data
Runs are stored in `data/runs/<run-id>/` (gitignored):

| Path | Content |
| --- | --- |
| `manifest.json` | URL, personas, scenario snapshot, report language, status |
| `cells/<persona>__<scenario>.json` | Live record of one cell: status, actions, observations, verdict |
| `cells/<persona>__<scenario>.md` | Final report in the report language |
| `cells/<persona>__<scenario>.raw.txt` | The persona's raw final answer (and repair attempt) |
| `screenshots/` | Screenshots and zoom images |

Active runs are tracked in memory only; restarting the server stops them, and their status stays `running`.
