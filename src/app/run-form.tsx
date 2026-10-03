"use client";

import Link from "next/link";
import { useState } from "react";

import {
  EXPLORE_SCENARIO,
  matchesTargetHost,
  type Scenario,
} from "@/lib/scenario-model";
import styles from "./page.module.css";

type RunFormProps = {
  action: (formData: FormData) => Promise<void>;
  personas: { id: string; name: string }[];
  scenarios: Pick<Scenario, "id" | "title" | "targetHost" | "allowSubmit">[];
};

export function RunForm({ action, personas, scenarios }: RunFormProps) {
  const [url, setUrl] = useState("");
  const [selectedScenarios, setSelectedScenarios] = useState<Set<string>>(
    () => new Set([EXPLORE_SCENARIO.id]),
  );
  const [selectedPersonas, setSelectedPersonas] = useState<Set<string>>(
    () => new Set(personas.map((persona) => persona.id)),
  );

  const allScenarios = [EXPLORE_SCENARIO, ...scenarios];
  const matching = allScenarios.filter((scenario) => matchesTargetHost(scenario, url));
  const others = allScenarios.filter((scenario) => !matchesTargetHost(scenario, url));
  const cellCount = selectedScenarios.size * selectedPersonas.size;
  const submits = allScenarios.some(
    (scenario) => scenario.allowSubmit && selectedScenarios.has(scenario.id),
  );

  const toggle = (setter: typeof setSelectedScenarios, id: string) => {
    setter((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const renderScenario = (scenario: (typeof allScenarios)[number]) => (
    <label key={scenario.id} className={styles.choice}>
      <input
        type="checkbox"
        name="scenario"
        value={scenario.id}
        checked={selectedScenarios.has(scenario.id)}
        onChange={() => toggle(setSelectedScenarios, scenario.id)}
      />
      <span>{scenario.title}</span>
      {scenario.targetHost ? (
        <span className={styles.choiceHint}>{scenario.targetHost}</span>
      ) : null}
    </label>
  );

  return (
    <form className={styles.form} action={action}>
      <label className={styles.label} htmlFor="url">
        Website URL
      </label>
      <div className={styles.inputRow}>
        <input
          id="url"
          name="url"
          type="url"
          className={styles.input}
          placeholder="https://your-site.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
        />
        <button className={styles.submitButton} type="submit" disabled={cellCount === 0}>
          TEST
        </button>
      </div>

      <fieldset className={styles.choiceGroup}>
        <legend className={styles.label}>
          Scenarios <Link href="/scenarios" className={styles.inlineLink}>Manage</Link>
        </legend>
        <div className={styles.choiceList}>{matching.map(renderScenario)}</div>
        {others.length > 0 ? (
          <details className={styles.otherChoices}>
            <summary>Scenarios for other sites ({others.length})</summary>
            <div className={styles.choiceList}>{others.map(renderScenario)}</div>
          </details>
        ) : null}
      </fieldset>

      <fieldset className={styles.choiceGroup}>
        <legend className={styles.label}>Testers</legend>
        <div className={styles.choiceList}>
          {personas.map((persona) => (
            <label key={persona.id} className={styles.choice}>
              <input
                type="checkbox"
                name="persona"
                value={persona.id}
                checked={selectedPersonas.has(persona.id)}
                onChange={() => toggle(setSelectedPersonas, persona.id)}
              />
              <span>{persona.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className={styles.formNote}>
        {cellCount === 0
          ? "Select at least one scenario and one tester."
          : `${selectedPersonas.size} tester${selectedPersonas.size === 1 ? "" : "s"} × ${selectedScenarios.size} scenario${selectedScenarios.size === 1 ? "" : "s"} = ${cellCount} test run${cellCount === 1 ? "" : "s"}.`}
        {submits ? (
          <strong className={styles.formWarning}>
            {" "}
            Some selected scenarios may submit forms. Only test staging or test environments.
          </strong>
        ) : null}
      </p>
    </form>
  );
}
