import { cookies, headers } from "next/headers";

import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { format, plural, type PluralForms } from "@/i18n/format";

/** The request's locale: the saved choice (cookie), else the browser language, else English. */
export async function getLocale() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  return resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerStore.get("accept-language"),
  );
}

/** Translations for server components and server actions. */
export async function getI18n() {
  const locale = await getLocale();

  return {
    locale,
    t: getDictionary(locale),
    format,
    plural: (forms: PluralForms, count: number, params?: Record<string, string | number>) =>
      plural(locale, forms, count, params),
  };
}
