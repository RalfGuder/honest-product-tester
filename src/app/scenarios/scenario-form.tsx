"use client";

import { useActionState, useState } from "react";

import {
  DEFAULT_MAX_STEPS,
  MAX_STEPS_LIMIT,
  SCENARIO_ASSERTION_TYPES,
  type Scenario,
  type ScenarioAssertion,
} from "@/lib/scenario-model";
import { saveScenarioAction, type ScenarioFormState } from "./actions";
import styles from "./scenarios.module.css";

const LOGIN_OPTIONS = [
  { value: "auto", label: "Auto – log in when the tester has credentials" },
  { value: "required", label: "Required – skip testers without credentials" },
  { value: "anonymous", label: "Anonymous – never log in" },
] as const;

const ASSERTION_LABELS: Record<ScenarioAssertion["type"], string> = {
  url_contains: "Final URL contains",
  text_visible: "Page shows text",
};

const initialState: ScenarioFormState = { attempt: 0 };

export function ScenarioForm({ scenario }: { scenario?: Scenario }) {
  const [state, formAction, pending] = useActionState(saveScenarioAction, initialState);
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
        <span>Title</span>
        <input name="title" defaultValue={value("title")} required maxLength={120} />
        {scenario ? <small>ID: {scenario.id} (stays the same when the title changes)</small> : null}
      </label>

      <label className={styles.field}>
        <span>Mission</span>
        <textarea
          name="mission"
          defaultValue={value("mission")}
          required
          rows={5}
          placeholder="You want to find a recipe for dinner and save it for later."
        />
        <small>Written to the tester. Describe the goal, not the clicks.</small>
      </label>

      <label className={styles.field}>
        <span>Success criterion</span>
        <input
          name="successCriteria"
          defaultValue={value("successCriteria")}
          required
          placeholder="The recipe appears in the favorites list"
        />
      </label>

      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span>Target host (optional)</span>
          <input
            name="targetHost"
            defaultValue={value("targetHost")}
            placeholder="shop.example.com"
          />
          <small>Shown first when the run URL is on this host. Empty = any site.</small>
        </label>
        <label className={styles.field}>
          <span>Start path (optional)</span>
          <input name="startPath" defaultValue={value("startPath")} placeholder="/recipes" />
          <small>Relative to the run URL&apos;s origin.</small>
        </label>
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span>Login</span>
          <select name="login" defaultValue={value("login") ?? "auto"}>
            {LOGIN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Max browser actions</span>
          <input
            name="maxSteps"
            type="number"
            min={1}
            max={MAX_STEPS_LIMIT}
            defaultValue={value("maxSteps") ?? DEFAULT_MAX_STEPS}
          />
        </label>
      </div>

      <label className={styles.checkboxField}>
        <input
          type="checkbox"
          name="allowSubmit"
          checked={allowSubmit}
          onChange={(event) => setAllowSubmit(event.target.checked)}
        />
        <span>Allow submitting forms</span>
      </label>
      {allowSubmit ? (
        <p className={styles.warning}>
          Testers will really submit forms on the target site. Only use this against staging or
          test environments. Purchases, payments, deleting data and account changes stay
          forbidden.
        </p>
      ) : null}

      <fieldset className={styles.assertions}>
        <legend>Assertions (optional)</legend>
        <p className={styles.hint}>
          Checked by code after the tester finishes. They override the tester&apos;s own verdict.
        </p>
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
                  {ASSERTION_LABELS[type]}
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
              Remove
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
          Add assertion
        </button>
      </fieldset>

      {state.error ? <p className={styles.error}>{state.error}</p> : null}

      <div className={styles.actions}>
        <button type="submit" className={styles.primaryButton} disabled={pending}>
          {pending ? "Saving…" : "Save scenario"}
        </button>
      </div>
    </form>
  );
}
