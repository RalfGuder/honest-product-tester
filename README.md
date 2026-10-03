# Real Feedback From Fake People

[![Product demo](./demo-preview.gif)](./demo.mp4)

> **Catch your AI slop before your customers do.** **Real Feedback** deploys six opinionated, autonomous AI personas to live-test your website. Instead of static analysis, we use real browser automation to turn first impressions into actionable feedback and critiques.

## ✨ The "Aha!" Moment
* **Parallel Agent Execution:** This isn't a mock. We spin up **six concurrent Pi sessions** that browse your site in parallel, each with their own browser instance and unique worldview.
* **Autonomous Tool Use:** We don't hardcode paths. Personas like *Dark Muckerberg* or *Chef Lamb Sauce* use a custom `agent-browser` toolset to click, type, and scroll based on their own goals.
* **Live Voyeurism:** Watch the "Terminal of Truth" in real-time. The UI streams the raw thoughts, actions, and screenshots of the agents as they navigate your DOM.

## 🎭 The Testers
Our agents are loaded from Markdown-based persona definitions:
* **Dark Muckerberg:** Looking for data moats and optimization.
* **Cardi Confused:** If it’s not intuitive, she’s out.
* **Chef Lamb Sauce:** "It’s RAW!"—critiquing UI polish and performance.
* **Tom Thanks:** The nicest guy in tech, looking for the silver lining.
* **Sir Stack-Overflow:** Testing your technical edge cases.
* **Multitasking Millie:** Can your site hold attention?

## 🧠 How it Works (The Flow)
1.  **Ingestion:** User submits a URL via the **Next.js 16** frontend.
2.  **Persona Loading:** Profiles are pulled from **Markdown frontmatter**, defining the durable instruction set for the agents.
3.  **The Agent Loop:** Each persona initializes a **Pi SDK session** connected to a custom browser control layer.
4.  **Autonomous Browsing:** Agents use `agent-browser` tools (`browser_click`, `browser_type`, `browser_scroll`) to interact with the site, capturing raw observations and screenshots stored in a filesystem-backed run (`data/runs/`).
5.  **Synthesis:** Agents distill the chaos into a **strict 4-question JSON summary** and a final Markdown report for the dashboard.

## 🛠️ The Tech Stack
* **Frontend:** `Next.js 16.2` • `React 19.2` • `Lucide React`
* **Agent Logic:** `Pi SDK` (Reasoning) • `agent-browser` (Execution)
* **Data Layer:** Filesystem-backed persistence (JSON/MD/Screenshots)
* **Parsing:** `gray-matter` for persona definitions

## 🏁 Quick Start
* Make sure you have PI Agent installed and are properly logged in with one of your Accounts, it will use it.

```bash
npm install
npm run dev

## 🔐 Login per Persona
If the site under test needs a login, every persona logs in with its **own** account before it starts browsing. The model never sees the password.

1. Copy `credentials.example.json` to `credentials.local.json` (gitignored) or point `HPT_CREDENTIALS_FILE` at a file outside the repo.
2. Set `loginUrl` and one `username`/`password` per persona id. Usernames must be unique.
3. `basicAuth` is optional: set it when an HTTP Basic Auth gate (e.g. Caddy on staging) sits in front of the site. It is shared by all personas. The tester answers the gate from Node and passes only the gate cookies to the browser, so the app's own Bearer tokens are not overwritten.
4. The selector fields are optional; leave them out to let `agent-browser auth login` detect the form.
5. After submitting, the login is verified for about 8 seconds: the persona fails if the page stays on the login path, if a Blazor error banner (`#blazor-error-ui`) appears, or if the optional `loggedInSelector` is missing.

Without a credentials file, runs behave as before. A persona missing from the file fails with `No login configured for persona <id>`.
