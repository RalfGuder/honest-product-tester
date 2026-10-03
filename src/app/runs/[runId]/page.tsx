import { notFound } from "next/navigation";

import { getRun } from "@/lib/runs";
import { RunDetails } from "./run-details";
import styles from "./page.module.css";

type RunPageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function RunPage({ params }: RunPageProps) {
  const { runId } = await params;
  const run = await getRun(runId).catch(() => null);

  if (!run) {
    notFound();
  }

  const { manifest, cells } = run;

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <RunDetails initialRun={{ manifest, cells }} />
      </main>
    </div>
  );
}
