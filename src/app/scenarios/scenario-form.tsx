"use client";

import { useActionState, useState } from "react";

import { useI18n } from "@/i18n/provider";
import {
  DEFAULT_MAX_STEPS,
  MAX_STEPS_LIMIT,
  SCENARIO_ASSERTION_TYPES,
  SCENARIO_LOGIN_MODES,
  type Scenario,
  type ScenarioAssertion,
} from "@/lib/scenario-model";
import { saveScenarioAction, type ScenarioFormState } from "./actions";
import styles from "./scenarios.module.css";

const initialState: ScenarioFormState = { attempt: 0 };

type ScenarioFormProps = {
  scenario?: Scenario;
  personas: { id: string; name: string }[];
};

export function ScenarioForm({ scenario, personas }: ScenarioFormProps) {
  const { t, format } = useI18n();
  const [state, formAction, pending] = useActionState(saveScenarioAction, initialState);
  const [assignedPersonas, setAssignedPersonas] = useState<Set<string>>(
    () => new Set(scenario?.personas ?? []),
  );
  const [assertions, setAssertions] = useState<ScenarioAssertion[]>(
    scenario?.assertions ?? [],
  );
  const [allowSubmit, setAllowSubmit] = useState(scenario?.allowSubmit ?? false);
  const value = (field: keyof Scenario & string) =>
    state.values?.[field] ?? (scenario?.[field] as string | number | undefined)?.toString();

  return (
    // Remount after each failed attempt so the uncontrolled fields pick up the submitted values.
    <form key={state.attempt} action={formAction} className={styles.form}>
      {scenario ? <input type="hidden" name="id" value={scenario.id} /> : null}

      <label className={styles.field}>
        <span>{t.scenarioForm.title}</span>
        <input name="title" defaultValue={value("title")} required maxLength={120} />
        {scenario ? <small>{format(t.scenarioForm.idHint, { id: scenario.id })}</small> : null}
      </label>

      <label className={styles.field}>
        <span>{t.scenarioForm.mission}</span>
        <textarea
          name="mission"
          defaultValue={value("mission")}
          required
          rows={5}
          placeholder={t.scenarioForm.missionPlaceholder}
        />
        <small>{t.scenarioForm.missionHint}</small>
      </label>

      <label className={styles.field}>
        <span>{t.scenarioForm.successCriteria}</span>
        <input
          name="successCriteria"
          defaultValue={value("successCriteria")}
          required
          placeholder={t.scenarioForm.successCriteriaPlaceholder}
        />
      </label>

      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span>{t.scenarioForm.targetHost}</span>
          <input
            name="targetHost"
            defaultValue={value("targetHost")}
            placeholder="shop.example.com"
          />
          <small>{t.scenarioForm.targetHostHint}</small>
        </label>
        <label className={styles.field}>
          <span>{t.scenarioForm.startPath}</span>
          <input name="startPath" defaultValue={value("startPath")} placeholder="/recipes" />
          <small>{t.scenarioForm.startPathHint}</small>
        </label>
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span>{t.scenarioForm.login}</span>
          <select name="login" defaultValue={value("login") ?? "auto"}>
            {SCENARIO_LOGIN_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t.scenarioForm.loginOptions[mode]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t.scenarioForm.maxSteps}</span>
          <input
            name="maxSteps"
            type="number"
            min={1}
            max={MAX_STEPS_LIMIT}
            defaultValue={value("maxSteps") ?? DEFAULT_MAX_STEPS}
          />
        </label>
      </div>

      <fieldset className={styles.assertions}>
        <legend>{t.scenarioForm.assignedTesters}</legend>
        <p className={styles.hint}>
          {assignedPersonas.size === 0
            ? t.scenarioForm.assignedAll
            : t.scenarioForm.assignedSome}
        </p>
        <div className={styles.personaChoices}>
          {personas.map((persona) => (
            <label key={persona.id} className={styles.checkboxField}>
              <input
                type="checkbox"
                name="assignedPersona"
                value={persona.id}
                checked={assignedPersonas.has(persona.id)}
                onChange={(event) => {
                  const { checked } = event.target;

                  setAssignedPersonas((current) => {
                    const next = new Set(current);

                    if (checked) {
                      next.add(persona.id);
                    } else {
                      next.delete(persona.id);
                    }

                    return next;
                  });
                }}
              />
              <span>{persona.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className={styles.checkboxField}>
        <input
          type="checkbox"
          name="allowSubmit"
          checked={allowSubmit}
          onChange={(event) => setAllowSubmit(event.target.checked)}
        />
        <span>{t.scenarioForm.allowSubmit}</span>
      </label>
      {allowSubmit ? (
        <p className={styles.warning}>{t.scenarioForm.allowSubmitWarning}</p>
      ) : null}

      <fieldset className={styles.assertions}>
        <legend>{t.scenarioForm.assertions}</legend>
        <p className={styles.hint}>{t.scenarioForm.assertionsHint}</p>
        {assertions.map((assertion, index) => (
          <div key={index} className={styles.assertionRow}>
            <select
              name="assertionType"
              value={assertion.type}
              onChange={(event) =>
                setAssertions((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, type: event.target.value as ScenarioAssertion["type"] }
                      : item,
                  ),
                )
              }
            >
              {SCENARIO_ASSERTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t.scenarioForm.assertionTypes[type]}
                </option>
              ))}
            </select>
            <input
              name="assertionValue"
              value={assertion.value}
              placeholder={assertion.type === "url_contains" ? "/favorites" : "Saved"}
              onChange={(event) =>
                setAssertions((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, value: event.target.value } : item,
                  ),
                )
              }
            />
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() =>
                setAssertions((current) => current.filter((_, itemIndex) => itemIndex !== index))
              }
            >
              {t.scenarioForm.remove}
            </button>
          </div>
        ))}
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() =>
            setAssertions((current) => [...current, { type: "url_contains", value: "" }])
          }
        >
          {t.scenarioForm.addAssertion}
        </button>
      </fieldset>

      {state.error ? <p className={styles.error}>{state.error}</p> : null}

      <div className={styles.actions}>
        <button type="submit" className={styles.primaryButton} disabled={pending}>
          {pending ? t.scenarioForm.saving : t.scenarioForm.save}
        </button>
      </div>
    </form>
  );
}
