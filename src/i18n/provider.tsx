"use client";

import { createContext, useContext, useMemo } from "react";

import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { format, plural, type PluralForms } from "@/i18n/format";

type I18nContextValue = {
  locale: Locale;
  t: Dictionary;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: Dictionary;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ locale, t: dictionary }), [locale, dictionary]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Translations for client components; the dictionary is handed down from the root layout. */
export function useI18n() {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider.");
  }

  const { locale, t } = context;

  return {
    locale,
    t,
    format,
    plural: (forms: PluralForms, count: number, params?: Record<string, string | number>) =>
      plural(locale, forms, count, params),
  };
}
