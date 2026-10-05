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

const DESKTOP_TOOL_RULES = `- Use desktop_snapshot whenever you need to decide what to do next. It lists the controls of the active window with refs like @e3; act on them by ref. Refs come from the latest snapshot: take a new one after anything changed.
- A new window or dialog becomes the active window automatically when it is modal. Use desktop_windows to see all windows and desktop_switch_window to look at another one.
- Use desktop_wait (text or window) after actions that take a while instead of guessing; plain waiting in milliseconds is a last resort.
- Lists and grids may show only part of their rows. Use desktop_table to read the rows of a grid, or desktop_scroll.
- Use desktop_screenshot when something is notably good, bad, or confusing, or when you need to see visual details such as colors, icons, or layout. You receive the screenshot as an image.`;

export function buildPersonaPrompt(
  persona: Persona,
  appName: string,
  loggedIn: boolean,
  reportLanguage: Locale | undefined,
) {
  return `
${persona.prompt}

You are testing this Windows desktop application live: ${appName}. It is already started.
${loggedIn ? LOGGED_IN_NOTE : ""}
Use the desktop tools to inspect the product in the way this persona naturally would. Do not follow a generic script. Let your priorities, interests, impatience, and curiosity determine what to do next.

Constraints:
- You may use only the desktop tools.
- Keep the run concise. Aim for 6 to 10 desktop actions total.
- You have the same fixed time budget as every other persona.
- No destructive actions, purchases, or final form submissions. Do not close the application.
${DESKTOP_TOOL_RULES}
- If the application is slow or broken, mention that in the relevant answer.

${exploreReportFormat(reportLanguage)}
`.trim();
}

export function buildMissionPrompt(
  persona: Persona,
  scenario: Scenario,
  appName: string,
  loggedIn: boolean,
  reportLanguage: Locale | undefined,
) {
  return `
${persona.prompt}

You are testing this Windows desktop application live: ${appName}. It is already started.
${loggedIn ? LOGGED_IN_NOTE : ""}
${missionBrief(persona, scenario)}

Constraints:
- You may use only the desktop tools.
- Hard budget: ${scenario.maxSteps} desktop actions (click, fill, select, check, expand, press, scroll, wait, switch window). Snapshots, screenshots, window lists, tables and value reads are free. When the budget is used up, actions fail; then stop and report.
- There is also a fixed time budget. When time is up, tools fail; then stop and report.
${submitRule(scenario)}
- Do not close the application.
${DESKTOP_TOOL_RULES}

${missionReportFormat(
  {
    locationField: `"finalWindow": "title of the window where you ended"`,
    quoteSource: "in that window",
    product: "in this application",
  },
  reportLanguage,
)}
`.trim();
}
