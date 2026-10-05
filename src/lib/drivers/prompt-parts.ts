// Prompt blocks shared by the web and desktop drivers.
import type { Locale } from "@/i18n/config";
import type { Persona } from "@/lib/personas";
import { reportLanguageInstruction } from "@/lib/report-language";
import { REPORT_INSIGHT_DEFINITIONS } from "@/lib/report-insights";
import { JSON_STRING_RULE } from "@/lib/report-parsing";
import type { Scenario } from "@/lib/scenario-format";

export const LOGGED_IN_NOTE =
  "\nYou are already logged in with your own test account. Do not log out or change account settings.\n";

const SUBMIT_ALLOWED_RULE =
  "- You may submit forms when the mission needs it (for example saving, sending a message). Never make purchases or payments, delete data, change passwords, email addresses or account settings, or log out.";
const SUBMIT_FORBIDDEN_RULE =
  "- Do not submit forms, make purchases, delete data, or change account settings. If the mission ends with a final submit, fill everything in, stop right before submitting, and count that as reaching the goal. Say so in evidence.quote.";

export function submitRule(scenario: Scenario) {
  return scenario.allowSubmit ? SUBMIT_ALLOWED_RULE : SUBMIT_FORBIDDEN_RULE;
}

/** End of the free exploration prompt: the insight questions and how to answer them. */
export function exploreReportFormat(reportLanguage: Locale | undefined) {
  const outputSchema = REPORT_INSIGHT_DEFINITIONS.map(
    ({ id, question }) => `  "${id}": "${question}"`,
  ).join("\n");

  return `When you are done, return only valid JSON in this exact shape:

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
${reportLanguageInstruction(reportLanguage)}`;
}

/** The mission, its success criterion and how the persona should approach it. */
export function missionBrief(persona: Persona, scenario: Scenario) {
  return `Your mission:
${scenario.mission}

You succeed when: ${scenario.successCriteria}

Work towards the mission the way this persona naturally would. Do not act like a test script: take the paths this persona would take, and react to the product with this persona's experience level and patience (${persona.patience}).
If this persona would realistically give up out of frustration or confusion, stop and report "gave_up". Giving up is a valid and valuable result.`;
}

/** End of a mission prompt: the report JSON and the verdict rules. */
export function missionReportFormat(
  {
    locationField,
    quoteSource,
    product,
  }: {
    // e.g. `"finalUrl": "URL of the page where you ended"`
    locationField: string;
    // where the evidence quote is visible, e.g. "on that page"
    quoteSource: string;
    // e.g. "on this site"
    product: string;
  },
  reportLanguage: Locale | undefined,
) {
  return `When you are done, return only valid JSON in this exact shape:

{
  "verdict": "passed" | "failed" | "gave_up" | "limit_reached",
  "evidence": {
    ${locationField},
    "quote": "exact text visible ${quoteSource} that proves the outcome"
  },
  "frictionPoints": ["each moment you hesitated, got lost, or were annoyed, in one short sentence"],
  "quote": "one sentence in this persona's voice that sums up the experience"
}

Verdict rules:
- "passed" only if the success criterion is visibly met. Be honest; your claim is checked afterwards.
- "failed" if you are convinced the goal cannot be reached ${product}.
- "gave_up" if this persona would stop trying.
- "limit_reached" if the step or time budget ran out first.
Do not include markdown, commentary, code fences, or extra keys.
${JSON_STRING_RULE}
${reportLanguageInstruction(reportLanguage)}`;
}
