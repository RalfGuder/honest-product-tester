"use client";

import styles from "./scenarios.module.css";

export function DeleteScenarioButton({ title }: { title: string }) {
  return (
    <button
      type="submit"
      className={styles.dangerButton}
      onClick={(event) => {
        if (!window.confirm(`Delete the scenario "${title}"? Past runs keep their copy.`)) {
          event.preventDefault();
        }
      }}
    >
      Delete
    </button>
  );
}
