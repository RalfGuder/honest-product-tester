import type { Locale } from "@/i18n/config";
import type { Persona } from "@/lib/personas";
import { reportLanguageInstruction } from "@/lib/report-language";
import { REPORT_INSIGHT_DEFINITIONS } from "@/lib/report-insights";
import { JSON_STRING_RULE } from "@/lib/report-parsing";
import type { Scenario } from "@/lib/scenario-format";

const LOGGED_IN_NOTE =
  "\nYou are already logged in with your own test account. Do not log out or change account settings.\n";

export function buildPersonaPrompt(
  persona: Persona,
  url: string,
  loggedIn: boolean,
  reportLanguage: Locale | undefined,
) {
  const outputSchema = REPORT_INSIGHT_DEFINITIONS.map(
    ({ id, question }) => `  "${id}": "${question}"`,
  ).join("\n");

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

When you are done, return only valid JSON in this exact shape:

{
${outputSchema}
}

Rules for the answers:
- Each value must be a short answer in this persona's voice.
- Aim for roughly 8 to 10 words per answer.
- Do not repeat the question inside the answer.
- Be concrete about what you clicked, what happened, and what this persona wanted but did not get.
- Do not include markdown, commentary, code fences, or extra keys.
${JSON_STRING_RULE}
${reportLanguageInstruction(reportLanguage)}
`.trim();
}

const SUBMIT_ALLOWED_RULE =
  "- You may submit forms when the mission needs it (for example saving, sending a message). Never make purchases or payments, delete data, change passwords, email addresses or account settings, or log out.";
const SUBMIT_FORBIDDEN_RULE =
  "- Do not submit forms, make purchases, delete data, or change account settings. If the mission ends with a final submit, fill everything in, stop right before submitting, and count that as reaching the goal. Say so in evidence.quote.";

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
Your mission:
${scenario.mission}

You succeed when: ${scenario.successCriteria}

Work towards the mission the way this persona naturally would. Do not act like a test script: take the paths this persona would take, and react to the product with this persona's experience level and patience (${persona.patience}).
If this persona would realistically give up out of frustration or confusion, stop and report "gave_up". Giving up is a valid and valuable result.

Constraints:
- You may use only the browser tools.
- Hard budget: ${scenario.maxSteps} browser actions (open, click, type, press, scroll, wait). Snapshots, screenshots, title and URL reads are free. When the budget is used up, actions fail; then stop and report.
- There is also a fixed time budget. When time is up, tools fail; then stop and report.
${scenario.allowSubmit ? SUBMIT_ALLOWED_RULE : SUBMIT_FORBIDDEN_RULE}
- Use browser_snapshot whenever you need to decide what to click next.
- Lists, dialogs and sidebars often scroll on their own and show only part of their content. When you need to see all entries, keep scrolling (use withinText for a specific list) until browser_scroll reports that the end is reached.
- Use browser_screenshot when something is notably good, bad, or confusing, or when you need to see visual details such as colors, icons, or status dots. You receive the screenshot as an image.
- Small details (status dots, tiny icons) are easy to miss on a full screenshot. Use browser_zoom with a visible text next to them, e.g. a person's name, to look closely, or browser_inspect to read the markup around that text.

When you are done, return only valid JSON in this exact shape:

{
  "verdict": "passed" | "failed" | "gave_up" | "limit_reached",
  "evidence": {
    "finalUrl": "URL of the page where you ended",
    "quote": "exact text visible on that page that proves the outcome"
  },
  "frictionPoints": ["each moment you hesitated, got lost, or were annoyed, in one short sentence"],
  "quote": "one sentence in this persona's voice that sums up the experience"
}

Verdict rules:
- "passed" only if the success criterion is visibly met. Be honest; your claim is checked afterwards.
- "failed" if you are convinced the goal cannot be reached on this site.
- "gave_up" if this persona would stop trying.
- "limit_reached" if the step or time budget ran out first.
Do not include markdown, commentary, code fences, or extra keys.
${JSON_STRING_RULE}
${reportLanguageInstruction(reportLanguage)}
`.trim();
}
