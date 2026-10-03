"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { setLocaleAction } from "@/i18n/actions";
import { LOCALE_NAMES, LOCALES } from "@/i18n/config";
import { useI18n } from "@/i18n/provider";
import styles from "./language-switcher.module.css";

export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className={styles.switcher}>
      <span className={styles.label}>{t.common.language}</span>
      <select
        value={locale}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;

          startTransition(async () => {
            await setLocaleAction(next);
            router.refresh();
          });
        }}
      >
        {LOCALES.map((item) => (
          <option key={item} value={item}>
            {LOCALE_NAMES[item]}
          </option>
        ))}
      </select>
    </label>
  );
}
