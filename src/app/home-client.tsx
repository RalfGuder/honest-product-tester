"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { useI18n } from "@/i18n/provider";
import type { LocalizedPersona as Persona } from "@/lib/personas";
import styles from "./page.module.css";

type HomeClientProps = {
  personas: Persona[];
};

function getPersonaSummary(persona: Persona, fallback: string) {
  if (persona.summary) {
    return persona.summary;
  }

  const firstLine = persona.prompt.split("\n")[0]?.trim() ?? "";
  const prefix = `You are ${persona.name}, `;

  if (firstLine.startsWith(prefix)) {
    return firstLine.slice(prefix.length).replace(/\.$/, "");
  }

  return fallback;
}

export function HomeClient({ personas }: HomeClientProps) {
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const { t, format } = useI18n();

  useEffect(() => {
    if (!selectedPersona) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedPersona(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedPersona]);

  return (
    <>
      <div className={styles.testerSection}>
        <div className={styles.testerHeadingWrap}>
          <p className={styles.testerHeading}>{t.testers.heading}</p>
          <span className={styles.testerTooltip} role="note">
            {t.testers.tooltip}
          </span>
        </div>
        <div className={styles.testerGrid}>
          {personas.map((persona) => (
            <button
              key={persona.id}
              type="button"
              className={styles.testerButton}
              onClick={() => setSelectedPersona(persona)}
            >
              <figure className={styles.testerCard}>
                <div className={styles.testerImageFrame}>
                  <Image
                    src={persona.avatar}
                    alt={persona.name}
                    width={220}
                    height={220}
                    className={styles.testerImage}
                  />
                </div>
                <figcaption className={styles.testerName}>{persona.name}</figcaption>
              </figure>
            </button>
          ))}
        </div>
      </div>

      {selectedPersona ? (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onClick={() => setSelectedPersona(null)}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="persona-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setSelectedPersona(null)}
              aria-label={t.testers.closeLabel}
            >
              {t.testers.close}
            </button>

            <div className={styles.modalHeader}>
              <div className={styles.modalImageFrame}>
                <Image
                  src={selectedPersona.avatar}
                  alt={selectedPersona.name}
                  width={220}
                  height={220}
                  className={styles.testerImage}
                />
              </div>

              <div className={styles.modalIntro}>
                <p className={styles.modalTag}>
                  {format(t.testers.inspiredBy, { name: selectedPersona.inspiredBy })}
                </p>
                <h2 id="persona-modal-title" className={styles.modalTitle}>
                  {selectedPersona.name}
                </h2>
                <p className={styles.modalSummary}>
                  {getPersonaSummary(
                    selectedPersona,
                    format(t.testers.fallbackSummary, { voice: selectedPersona.voice }),
                  )}
                  .
                </p>
                <div className={styles.modalMeta}>
                  <span className={styles.metaPill}>
                    {format(t.testers.voice, { value: selectedPersona.voice })}
                  </span>
                  <span className={styles.metaPill}>
                    {format(t.testers.experience, { value: selectedPersona.experienceLevel })}
                  </span>
                  <span className={styles.metaPill}>
                    {format(t.testers.patience, { value: selectedPersona.patience })}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.modalGrid}>
              <section className={styles.modalSection}>
                <h3 className={styles.modalSectionTitle}>{t.testers.focus}</h3>
                <ul className={styles.modalList}>
                  {selectedPersona.goals.map((goal) => (
                    <li key={goal}>{goal}</li>
                  ))}
                </ul>
              </section>

              <section className={styles.modalSection}>
                <h3 className={styles.modalSectionTitle}>{t.testers.interests}</h3>
                <ul className={styles.modalList}>
                  {selectedPersona.interests.map((interest) => (
                    <li key={interest}>{interest}</li>
                  ))}
                </ul>
              </section>

              <section className={styles.modalSection}>
                <h3 className={styles.modalSectionTitle}>{t.testers.struggles}</h3>
                <ul className={styles.modalList}>
                  {selectedPersona.dislikes.map((dislike) => (
                    <li key={dislike}>{dislike}</li>
                  ))}
                </ul>
              </section>

              <section className={styles.modalSection}>
                <h3 className={styles.modalSectionTitle}>{t.testers.testingStyle}</h3>
                <ul className={styles.modalList}>
                  {selectedPersona.browseStyle.map((style) => (
                    <li key={style}>{style}</li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
