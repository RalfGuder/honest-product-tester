import Link from "next/link";

import { getI18n } from "@/i18n/server";
import { getPersonas } from "@/lib/personas";
import { ScenarioForm } from "../scenario-form";
import styles from "../scenarios.module.css";

export default async function NewScenarioPage() {
  const [personas, { t }] = await Promise.all([getPersonas(), getI18n()]);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.header}>
          <Link href="/scenarios" className={styles.backLink}>
            {t.common.back}
          </Link>
          <h1 className={styles.title}>{t.scenarioEdit.newTitle}</h1>
        </div>
        <ScenarioForm personas={personas.map(({ id, name }) => ({ id, name }))} />
      </main>
    </div>
  );
}
