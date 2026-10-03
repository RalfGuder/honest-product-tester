import Link from "next/link";
import { connection } from "next/server";

import { getScenarios } from "@/lib/scenarios";
import styles from "./scenarios.module.css";

export default async function ScenariosPage() {
  await connection();
  const scenarios = await getScenarios();

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.header}>
          <Link href="/" className={styles.backLink}>
            Back
          </Link>
          <h1 className={styles.title}>Test scenarios</h1>
          <Link href="/scenarios/new" className={styles.primaryButton}>
            New scenario
          </Link>
        </div>
        <p className={styles.intro}>
          A scenario gives every selected tester a mission and a success criterion. Each tester
          takes their own path and reports whether they made it, gave up, or failed.
        </p>

        {scenarios.length === 0 ? (
          <p className={styles.empty}>No scenarios yet. Create the first one.</p>
        ) : (
          <ul className={styles.list}>
            {scenarios.map((scenario) => (
              <li key={scenario.id} className={styles.card}>
                <Link href={`/scenarios/${scenario.id}`} className={styles.cardLink}>
                  <h2>{scenario.title}</h2>
                  <p>{scenario.successCriteria}</p>
                  <div className={styles.tags}>
                    <span>{scenario.targetHost ?? "any site"}</span>
                    <span>login: {scenario.login}</span>
                    <span>max {scenario.maxSteps} steps</span>
                    {scenario.allowSubmit ? (
                      <span className={styles.warnTag}>submits forms</span>
                    ) : null}
                    {scenario.assertions.length > 0 ? (
                      <span>{scenario.assertions.length} assertion(s)</span>
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
