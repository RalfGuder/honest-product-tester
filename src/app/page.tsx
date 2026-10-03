import { connection } from "next/server";

import { startRunAction } from "@/app/actions";
import { HomeClient } from "@/app/home-client";
import { RunForm } from "@/app/run-form";
import { getI18n } from "@/i18n/server";
import { getPersonas, localizePersona } from "@/lib/personas";
import { getScenarios } from "@/lib/scenarios";
import styles from "./page.module.css";

export default async function Home() {
  // Scenarios are edited at runtime, so render on every request.
  await connection();
  const [personas, scenarios, { locale, t }] = await Promise.all([
    getPersonas(),
    getScenarios(),
    getI18n(),
  ]);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>{t.home.eyebrow}</p>
          <h1 className={styles.title}>
            <span className={styles.titleLine}>{t.home.titleLine1}</span>
            <span className={styles.titleLine}>
              {t.home.titleFrom} <span className={styles.titleAccent}>{t.home.titleAccent}</span>
            </span>
          </h1>
          <p className={styles.lead}>{t.home.lead}</p>
        </section>

        <section id="ux-test-form" className={styles.formSection}>
          <RunForm
            action={startRunAction}
            defaultReportLanguage={locale}
            personas={personas.map(({ id, name }) => ({ id, name }))}
            scenarios={scenarios.map(({ id, title, targetHost, allowSubmit, personas: assigned }) => ({
              id,
              title,
              targetHost,
              allowSubmit,
              personas: assigned,
            }))}
          />
        </section>

        <HomeClient personas={personas.map((persona) => localizePersona(persona, locale))} />

        <footer className={styles.footer}>
          <p className={styles.footerCopy}>{t.home.builtBy}</p>
          <a
            href="https://github.com/kylo-at/honest-product-tester"
            target="_blank"
            rel="noreferrer"
            className={styles.footerLink}
          >
            <span className={styles.footerIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 1.5a10.5 10.5 0 0 0-3.32 20.47c.53.1.72-.22.72-.5v-1.93c-2.95.64-3.57-1.25-3.57-1.25-.48-1.22-1.18-1.55-1.18-1.55-.96-.66.08-.64.08-.64 1.07.08 1.63 1.1 1.63 1.1.94 1.62 2.48 1.15 3.08.88.1-.69.37-1.15.67-1.42-2.35-.27-4.82-1.17-4.82-5.24 0-1.16.41-2.11 1.09-2.86-.11-.27-.47-1.37.1-2.85 0 0 .89-.29 2.92 1.09a10.11 10.11 0 0 1 5.32 0c2.03-1.38 2.91-1.09 2.91-1.09.58 1.48.22 2.58.11 2.85.68.75 1.08 1.7 1.08 2.86 0 4.08-2.48 4.97-4.84 5.23.38.33.72.97.72 1.96v2.9c0 .28.19.61.73.5A10.5 10.5 0 0 0 12 1.5Z" />
              </svg>
            </span>
            <span>{t.home.githubRepo}</span>
          </a>
        </footer>
      </main>
    </div>
  );
}
