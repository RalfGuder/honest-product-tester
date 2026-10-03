// Dependency-free locale configuration, safe to import from client components.

export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "hpt-locale";

/** Language names in their own language, for the language switcher. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
};

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

/** Picks the best supported locale from an Accept-Language header. */
export function matchLocale(acceptLanguage: string | null | undefined): Locale {
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const quality = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));

      return {
        language: tag.trim().toLowerCase().split("-")[0],
        quality: quality ? Number.parseFloat(quality.slice(2)) : 1,
        index,
      };
    })
    .filter((entry) => entry.language && !Number.isNaN(entry.quality) && entry.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  const match = ranked.find((entry) => isLocale(entry.language))?.language;

  return isLocale(match) ? match : DEFAULT_LOCALE;
}

/** An explicit choice (cookie) wins over the browser language. */
export function resolveLocale(cookieValue: string | undefined, acceptLanguage: string | null) {
  return isLocale(cookieValue) ? cookieValue : matchLocale(acceptLanguage);
}
