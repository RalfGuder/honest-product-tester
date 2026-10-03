"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getI18n } from "@/i18n/server";
import { getPersonas } from "@/lib/personas";
import { scenarioFromForm, ScenarioValidationError } from "@/lib/scenario-format";
import { deleteScenario, saveScenario } from "@/lib/scenarios";

export type ScenarioFormState = {
  error?: string;
  // Submitted text fields, so the form can be refilled after React resets it on error.
  values?: Record<string, string>;
  attempt: number;
};

const TEXT_FIELDS = ["title", "mission", "successCriteria", "targetHost", "startPath", "login", "maxSteps"];

export async function saveScenarioAction(
  previous: ScenarioFormState,
  formData: FormData,
): Promise<ScenarioFormState> {
  const isNew = !formData.get("id");

  try {
    const scenario = scenarioFromForm(formData);
    const knownIds = new Set((await getPersonas()).map((persona) => persona.id));

    await saveScenario(
      { ...scenario, personas: scenario.personas?.filter((id) => knownIds.has(id)) },
      { mustBeNew: isNew },
    );
  } catch (error) {
    const { t, format } = await getI18n();

    return {
      error:
        error instanceof ScenarioValidationError
          ? format(t.errors[error.code], error.params)
          : t.errors.saveFailed,
      values: Object.fromEntries(
        TEXT_FIELDS.map((field) => [field, String(formData.get(field) ?? "")]),
      ),
      attempt: previous.attempt + 1,
    };
  }

  revalidatePath("/scenarios");
  revalidatePath("/");
  redirect("/scenarios");
}

export async function deleteScenarioAction(formData: FormData) {
  const id = formData.get("id");

  if (typeof id === "string" && id) {
    await deleteScenario(id);
  }

  revalidatePath("/scenarios");
  revalidatePath("/");
  redirect("/scenarios");
}
