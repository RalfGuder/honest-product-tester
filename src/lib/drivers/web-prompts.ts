import type { Locale } from "@/i18n/config";
import type { Persona } from "@/lib/personas";
import type { Scenario } from "@/lib/scenario-format";

import {
  exploreReportFormat,
  LOGGED_IN_NOTE,
  missionBrief,
  missionReportFormat,
  submitRule,
} from "@/lib/drivers/prompt-parts";

export function buildPersonaPrompt(
  persona: Persona,
  url: string,
  loggedIn: boolean,
  reportLanguage: Locale | undefined,
) {
  return `
${persona.prompt}

You are testing this ${loggedIn ? "" : "public "}website live: ${url}
${loggedIn ? LOGGED_IN_NOTE : ""}
Use the browser tools to inspect the product in the way this persona naturally would. Do not follow a generic script. Let your priorities, interests, impatience, and curiosity determine what to do next.

Constraints:
- You may use only the browser tools.
- Keep the run concise. Aim for 6 to 10 browser actions total.
- You have the same fixed time budget as every other persona.
- No destructive actions, purchases, or final form submissions.
- Use browser_snapshot whenever you need to decide what to click next.
- Lists, dialogs and sidebars often scroll on their own and show only part of their content. When you need to see all entries, keep scrolling (use withinText for a specific list) until browser_scroll reports that the end is reached.
- Use browser_screenshot when something is notably good, bad, or confusing, or when you need to see visual details such as colors, icons, or status dots. You receive the screenshot as an image.
- Small details (status dots, tiny icons) are easy to miss on a full screenshot. Use browser_zoom with a visible text next to them, e.g. a person's name, to look closely, or browser_inspect to read the markup around that text.
- If a page is slow or broken, mention that in the relevant answer.

${exploreReportFormat(reportLanguage)}
`.trim();
}

export function buildMissionPrompt(
  persona: Persona,
  scenario: Scenario,
  url: string,
  loggedIn: boolean,
  reportLanguage: Locale | undefined,
) {
  return `
${persona.prompt}

You are testing this ${loggedIn ? "" : "public "}website live, starting at: ${url}
${loggedIn ? LOGGED_IN_NOTE : ""}
${missionBrief(persona, scenario)}

Constraints:
- You may use only the browser tools.
- Hard budget: ${scenario.maxSteps} browser actions (open, click, type, press, scroll, wait). Snapshots, screenshots, title and URL reads are free. When the budget is used up, actions fail; then stop and report.
- There is also a fixed time budget. When time is up, tools fail; then stop and report.
${submitRule(scenario)}
- Use browser_snapshot whenever you need to decide what to click next.
- Lists, dialogs and sidebars often scroll on their own and show only part of their content. When you need to see all entries, keep scrolling (use withinText for a specific list) until browser_scroll reports that the end is reached.
- Use browser_screenshot when something is notably good, bad, or confusing, or when you need to see visual details such as colors, icons, or status dots. You receive the screenshot as an image.
- Small details (status dots, tiny icons) are easy to miss on a full screenshot. Use browser_zoom with a visible text next to them, e.g. a person's name, to look closely, or browser_inspect to read the markup around that text.

${missionReportFormat(
  {
    locationField: `"finalUrl": "URL of the page where you ended"`,
    quoteSource: "on that page",
    product: "on this site",
  },
  reportLanguage,
)}
`.trim();
}
