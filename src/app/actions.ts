"use server";

import { redirect } from "next/navigation";

import { isLocale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { getPersonas } from "@/lib/personas";
import { ensureRunStarted } from "@/lib/run-executor";
import { createRun } from "@/lib/runs";
import type { Scenario } from "@/lib/scenario-format";
import { getScenario } from "@/lib/scenarios";

export async function startRunAction(formData: FormData) {
  const urlValue = formData.get("url");
  const url = typeof urlValue === "string" ? urlValue : "";
  const personaIds = new Set(formData.getAll("persona").map(String));
  const personas = (await getPersonas()).filter((persona) => personaIds.has(persona.id));
  const scenarios = (
    await Promise.all(formData.getAll("scenario").map((id) => getScenario(String(id))))
  ).filter((scenario): scenario is Scenario => Boolean(scenario));
  const reportLanguageValue = formData.get("reportLanguage");
  const reportLanguage = isLocale(reportLanguageValue) ? reportLanguageValue : await getLocale();
  const run = await createRun({ kind: "web", url }, personas, scenarios, reportLanguage);
  ensureRunStarted(run.id);

  redirect(`/runs/${run.id}`);
}
