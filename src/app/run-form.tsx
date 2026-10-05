"use client";

import Link from "next/link";
import { useState } from "react";

import { LOCALE_NAMES, LOCALES, type Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/provider";
import {
  buildCellPlan,
  EXPLORE_SCENARIO,
  isPersonaAssigned,
  matchesTarget,
  TARGET_KINDS,
  type Scenario,
  type TargetKind,
} from "@/lib/scenario-model";
import styles from "./page.module.css";

type RunFormProps = {
  action: (formData: FormData) => Promise<void>;
  defaultReportLanguage: Locale;
  personas: { id: string; name: string }[];
  scenarios: Pick<Scenario, "id" | "title" | "targetHost" | "targetApp" | "allowSubmit" | "personas">[];
  // Allowlisted desktop apps; empty when desktop runs are not possible here.
  desktopApps: { id: string; name: string }[];
  desktopAppsError?: string;
};

export function RunForm({
  action,
  defaultReportLanguage,
  personas,
  scenarios,
  desktopApps,
  desktopAppsError,
}: RunFormProps) {
  const { t, format, plural } = useI18n();
  const [targetKind, setTargetKind] = useState<TargetKind>("web");
  const [url, setUrl] = useState("");
  const [appId, setAppId] = useState(desktopApps[0]?.id ?? "");
  const [selectedScenarios, setSelectedScenarios] = useState<Set<string>>(
    () => new Set([EXPLORE_SCENARIO.id]),
  );
  const [selectedPersonas, setSelectedPersonas] = useState<Set<string>>(
    () => new Set(personas.map((persona) => persona.id)),
  );

  const allScenarios = [EXPLORE_SCENARIO, ...scenarios];
  const target =
    targetKind === "desktop" ? { kind: "desktop" as const, appId } : { kind: "web" as const, url };
  const matching = allScenarios.filter((scenario) => matchesTarget(scenario, target));
  const others = allScenarios.filter((scenario) => !matchesTarget(scenario, target));
  const personaNames = new Map(personas.map((persona) => [persona.id, persona.name]));
  const chosenScenarios = allScenarios.filter((scenario) => selectedScenarios.has(scenario.id));
  const cellCount = buildCellPlan([...selectedPersonas], chosenScenarios).length;
  // Selected scenarios that none of the selected testers is assigned to.
  const unstaffed = chosenScenarios.filter(
    (scenario) =>
      ![...selectedPersonas].some((personaId) => isPersonaAssigned(scenario, personaId)),
  );
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
      <span>
        {scenario.id === EXPLORE_SCENARIO.id ? t.scenarios.explore : scenario.title}
      </span>
      {scenario.targetHost || scenario.targetApp ? (
        <span className={styles.choiceHint}>{scenario.targetHost ?? scenario.targetApp}</span>
      ) : null}
      {scenario.personas?.length ? (
        <span className={styles.choiceHint}>
          {format(t.runForm.onlyFor, {
            names: scenario.personas.map((id) => personaNames.get(id) ?? id).join(", "),
          })}
        </span>
      ) : null}
    </label>
  );

  return (
    <form className={styles.form} action={action}>
      {desktopApps.length > 0 ? (
        <div className={styles.choiceList} role="radiogroup" aria-label={t.runForm.targetKind}>
          {TARGET_KINDS.map((kind) => (
            <label key={kind} className={styles.choice}>
              <input
                type="radio"
                name="targetKind"
                value={kind}
                checked={targetKind === kind}
                onChange={() => setTargetKind(kind)}
              />
              <span>{kind === "web" ? t.runForm.targetWeb : t.runForm.targetDesktop}</span>
            </label>
          ))}
        </div>
      ) : null}
      {desktopAppsError ? (
        <p className={styles.formWarning}>
          {format(t.runForm.desktopAppsError, { error: desktopAppsError })}
        </p>
      ) : null}
      <label className={styles.label} htmlFor={targetKind === "desktop" ? "appId" : "url"}>
        {targetKind === "desktop" ? t.runForm.appLabel : t.runForm.urlLabel}
      </label>
      <div className={styles.inputRow}>
        {targetKind === "desktop" ? (
          <select
            id="appId"
            name="appId"
            className={styles.input}
            value={appId}
            onChange={(event) => setAppId(event.target.value)}
            required
          >
            {desktopApps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="url"
            name="url"
            type="url"
            className={styles.input}
            placeholder={t.runForm.urlPlaceholder}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
          />
        )}
        <button className={styles.submitButton} type="submit" disabled={cellCount === 0}>
          {t.runForm.submit}
        </button>
      </div>

      <fieldset className={styles.choiceGroup}>
        <legend className={styles.label}>
          {t.runForm.scenarios}{" "}
          <Link href="/scenarios" className={styles.inlineLink}>
            {t.runForm.manage}
          </Link>
        </legend>
        <div className={styles.choiceList}>{matching.map(renderScenario)}</div>
        {others.length > 0 ? (
          <details className={styles.otherChoices}>
            <summary>{format(t.runForm.otherSites, { count: others.length })}</summary>
            <div className={styles.choiceList}>{others.map(renderScenario)}</div>
          </details>
        ) : null}
      </fieldset>

      <fieldset className={styles.choiceGroup}>
        <legend className={styles.label}>{t.runForm.testers}</legend>
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

      <label className={styles.inlineField}>
        <span className={styles.label}>{t.runForm.reportLanguage}</span>
        <select name="reportLanguage" defaultValue={defaultReportLanguage}>
          {LOCALES.map((item) => (
            <option key={item} value={item}>
              {LOCALE_NAMES[item]}
            </option>
          ))}
        </select>
      </label>

      <p className={styles.formNote}>
        {cellCount === 0
          ? t.runForm.noCells
          : format(t.runForm.summary, {
              runs: plural(t.runForm.runs, cellCount),
              testers: plural(t.runForm.testerCount, selectedPersonas.size),
              scenarios: plural(t.runForm.scenarioCount, selectedScenarios.size),
            })}
        {unstaffed.length > 0 ? (
          <strong className={styles.formWarning}>
            {" "}
            {format(t.runForm.unstaffed, {
              titles: unstaffed
                .map((scenario) =>
                  scenario.id === EXPLORE_SCENARIO.id ? t.scenarios.explore : scenario.title,
                )
                .join(", "),
            })}
          </strong>
        ) : null}
        {submits ? (
          <strong className={styles.formWarning}>
            {" "}
            {t.runForm.submitWarning}
          </strong>
        ) : null}
      </p>
    </form>
  );
}
