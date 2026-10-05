import Link from "next/link";
import { connection } from "next/server";

import { getI18n } from "@/i18n/server";
import { getPersonas } from "@/lib/personas";
import { getScenarios } from "@/lib/scenarios";
import styles from "./scenarios.module.css";

export default async function ScenariosPage() {
  await connection();
  const [scenarios, personas, { t, format, plural }] = await Promise.all([
    getScenarios(),
    getPersonas(),
    getI18n(),
  ]);
  const personaNames = new Map(personas.map((persona) => [persona.id, persona.name]));

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.header}>
          <Link href="/" className={styles.backLink}>
            {t.common.back}
          </Link>
          <h1 className={styles.title}>{t.scenarioList.title}</h1>
          <Link href="/scenarios/new" className={styles.primaryButton}>
            {t.scenarioList.newScenario}
          </Link>
        </div>
        <p className={styles.intro}>{t.scenarioList.intro}</p>

        {scenarios.length === 0 ? (
          <p className={styles.empty}>{t.scenarioList.empty}</p>
        ) : (
          <ul className={styles.list}>
            {scenarios.map((scenario) => (
              <li key={scenario.id} className={styles.card}>
                <Link href={`/scenarios/${scenario.id}`} className={styles.cardLink}>
                  <h2>{scenario.title}</h2>
                  <p>{scenario.successCriteria}</p>
                  <div className={styles.tags}>
                    <span>
                      {scenario.personas?.length
                        ? format(t.scenarioList.testers, {
                            names: scenario.personas
                              .map((id) => personaNames.get(id) ?? id)
                              .join(", "),
                          })
                        : t.scenarioList.allTesters}
                    </span>
                    <span>{scenario.targetHost ?? scenario.targetApp ?? t.scenarioList.anySite}</span>
                    <span>{format(t.scenarioList.login, { mode: scenario.login })}</span>
                    <span>{format(t.scenarioList.maxSteps, { count: scenario.maxSteps })}</span>
                    {scenario.allowSubmit ? (
                      <span className={styles.warnTag}>{t.scenarioList.submitsForms}</span>
                    ) : null}
                    {scenario.assertions.length > 0 ? (
                      <span>{plural(t.scenarioList.assertions, scenario.assertions.length)}</span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
