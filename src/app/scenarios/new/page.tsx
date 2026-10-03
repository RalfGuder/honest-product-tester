import Link from "next/link";

import { ScenarioForm } from "../scenario-form";
import styles from "../scenarios.module.css";

export default function NewScenarioPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.header}>
          <Link href="/scenarios" className={styles.backLink}>
            Back
          </Link>
          <h1 className={styles.title}>New scenario</h1>
        </div>
        <ScenarioForm />
      </main>
    </div>
  );
}
