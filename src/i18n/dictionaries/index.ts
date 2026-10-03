import type { Locale } from "@/i18n/config";
import { de } from "./de";
import { en, type Dictionary } from "./en";

export type { Dictionary };

const DICTIONARIES: Record<Locale, Dictionary> = { en, de };

export function getDictionary(locale: Locale) {
  return DICTIONARIES[locale];
}
