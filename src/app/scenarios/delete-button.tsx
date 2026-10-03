"use client";

import { useI18n } from "@/i18n/provider";
import styles from "./scenarios.module.css";

export function DeleteScenarioButton({ title }: { title: string }) {
  const { t, format } = useI18n();

  return (
    <button
      type="submit"
      className={styles.dangerButton}
      onClick={(event) => {
        if (!window.confirm(format(t.scenarioEdit.deleteConfirm, { title }))) {
          event.preventDefault();
        }
      }}
    >
      {t.scenarioEdit.delete}
    </button>
  );
}
