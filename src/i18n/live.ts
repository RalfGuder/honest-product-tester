import type { Dictionary } from "@/i18n/dictionaries/en";
import { format } from "@/i18n/format";
import { EXPLORE_SCENARIO_ID } from "@/lib/scenario-model";

export type LiveMessageKey = keyof Dictionary["live"];

/** A status or timeline message stored in a run record, translated when it is displayed. */
export type LiveMessage = {
  key: LiveMessageKey;
  params?: Record<string, string | number>;
};

// Runs created before live messages were localized store plain English strings.
export type LiveText = string | LiveMessage;

export function renderLiveText(text: LiveText, t: Dictionary) {
  if (typeof text === "string") {
    return text;
  }

  const template = t.live[text.key];

  if (!template) {
    return text.key;
  }

  const params = { ...text.params };
  const verdict = params.verdict;

  if (typeof verdict === "string" && verdict in t.verdicts) {
    params.verdict = t.verdicts[verdict as keyof Dictionary["verdicts"]];
  }

  // The built-in free exploration has a translated title; custom scenario titles stay as written.
  if (params.scenarioId === EXPLORE_SCENARIO_ID) {
    params.title = t.scenarios.explore;
  }

  return format(template, params);
}
