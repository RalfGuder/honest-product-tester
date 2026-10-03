import Link from "next/link";
import { notFound } from "next/navigation";

import { getPersonas } from "@/lib/personas";
import { EXPLORE_SCENARIO_ID } from "@/lib/scenario-format";
import { getScenario } from "@/lib/scenarios";
import { deleteScenarioAction } from "../actions";
import { DeleteScenarioButton } from "../delete-button";
import { ScenarioForm } from "../scenario-form";
import styles from "../scenarios.module.css";

type ScenarioPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ScenarioPage({ params }: ScenarioPageProps) {
  const { id } = await params;
  const scenario =
    id === EXPLORE_SCENARIO_ID ? undefined : await getScenario(id).catch(() => undefined);

  if (!scenario) {
    notFound();
  }

  const personas = await getPersonas();

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.header}>
          <Link href="/scenarios" className={styles.backLink}>
            Back
          </Link>
          <h1 className={styles.title}>{scenario.title}</h1>
          <form action={deleteScenarioAction}>
            <input type="hidden" name="id" value={scenario.id} />
            <DeleteScenarioButton title={scenario.title} />
          </form>
        </div>
        <ScenarioForm
          scenario={scenario}
          personas={personas.map(({ id, name }) => ({ id, name }))}
        />
      </main>
    </div>
  );
}
