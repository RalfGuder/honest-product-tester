# Honest Product Tester Plan

## Goal

Build a hackathon MVP that takes a public website URL and runs a sequence of brutally honest product tests through multiple persona-driven agents. Each persona browses the site live in its own style, produces its own separate report, and contributes evidence such as actions, notes, and screenshots.

## Product Direction

- Input: public website URL only
- Execution: personas run in parallel
- Browsing: live interaction through `agent-browser`
- Orchestration: Pi SDK sessions drive reasoning and decide each next browser action
- Personas: stored as editable Markdown files in `personas/`
- Avatars: temporary placeholders now, user-provided images later
- Output: simple dashboard with persona cards and separate persona reports

## Key Decisions

### Browser Control

Use `agent-browser` rather than Playwright.

Reasoning:

- better fit for agent-first browsing
- snapshot and ref model is more natural for model-driven interaction
- live preview support is useful for demos
- less need to design a rigid scripted flow up front

### Agent Control Model

Use Option A: Pi decides the next browser action.

Implication:

- each Pi session receives the persona prompt, run constraints, recent browser state, and evidence collected so far
- Pi responds with the next action to take plus short internal reasoning/output for the app
- the app executes the action through `agent-browser`
- the loop continues until the persona decides it is done or the run budget is exhausted

### Persistence

Use filesystem persistence for the MVP.

Reasoning:

- fastest to build and debug during a hackathon
- easy to inspect manually during demos
- no database setup or schema migration overhead
- resilient enough to reopen previous runs if the UI refreshes

Proposed layout:

```text
data/
  runs/
    <run-id>/
      manifest.json
      personas/
        <persona-id>.json
        <persona-id>.md
      screenshots/
        <persona-id>-001.png
        <persona-id>-002.png
```

## Architecture

### Frontend

Next.js App Router dashboard with:

- URL input
- run queue / progress view
- persona cards with live status
- evidence snippets and screenshots
- separate final report panels per persona

### Backend App Layer

Server-side orchestration logic that:

- validates the submitted URL
- loads persona Markdown files
- creates a run folder
- executes personas sequentially
- writes events and outputs to disk

### Persona System

Each persona Markdown file should define:

- public identity
- inspiration source
- browsing behavior
- goals and dislikes
- reporting voice and sections
- avatar path
- prompt body

The body text is the durable persona instruction that gets passed into Pi.

### Agent Loop

For each persona:

1. Start Pi session with persona prompt and run rules.
2. Open website in `agent-browser`.
3. Feed the current browser snapshot and run history into Pi.
4. Ask Pi for the next action.
5. Execute the action through `agent-browser`.
6. Save evidence.
7. Repeat until done, timeout, or step budget reached.
8. Ask Pi for the final persona report in Markdown plus structured JSON.

### Evidence Model

Store per persona:

- action log
- current status
- notable observations
- screenshot paths
- final markdown report
- structured summary for rendering

## Shared Output Shape

Personas do not follow a shared browsing script, but they do report into the same schema so the dashboard can compare them cleanly.

Recommended report sections:

- what I noticed first
- what I tried to do
- what helped
- what annoyed me
- what I needed but could not find
- would I keep using this
- final verdict

The wording and tone inside those sections should still follow the persona.

## Run Constraints For MVP

- public websites only
- one persona at a time
- fixed max steps per persona
- fixed max duration per persona
- no login or payments
- no destructive form submission

## Implementation Phases

### Phase 1: Repo Scaffold

- create Next.js app
- add `PLAN.md`
- create `personas/` drafts
- add placeholder avatar assets
- create `data/runs/` persistence directory

### Phase 2: Dashboard Skeleton

- build homepage layout
- load personas from Markdown
- render cards and architecture notes
- add mock run state for the demo shell

### Phase 3: Run Engine

- create server action or API route to start a run
- create run folders and manifests
- append persona events to disk
- render run detail state in UI

### Phase 4: Agent Integration

- integrate Pi SDK session creation
- define the action contract for Pi outputs
- connect Pi decisions to `agent-browser` execution
- handle retries and invalid actions

### Phase 5: Evidence + Reporting

- save screenshots and action history
- generate separate Markdown reports per persona
- display reports in the dashboard

### Phase 6: Demo Hardening

- support rerunning the same URL
- preserve previous run output after refresh
- polish the UI and storytelling

## Immediate Next Tasks

1. Replace starter homepage with project-specific dashboard shell.
2. Add persona file loading from Markdown.
3. Add run domain types and on-disk persistence helpers.
4. Add `agent-browser` integration spike.
5. Add Pi SDK integration spike.

## Risks

- Pi may produce inconsistent action formats unless the action schema is tightly constrained.
- `agent-browser` can still be flaky on difficult sites, so we need time and step budgets plus graceful failure states.
- Running multiple external processes from Next.js requires careful handling of logs and long-running tasks.
- A flashy multi-agent UI is not the hard part; the loop reliability is.

## Non-Goals For Today

- authentication flows
- true parallel persona execution
- merged cross-persona master summary
- production-grade queueing
- database-backed analytics

## Follow-up Plans

- [WPF desktop apps as test targets](docs/plans/wpf-desktop-targets.md): drive Windows desktop apps via `agent-wpf` alongside websites.
