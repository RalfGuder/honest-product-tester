import type { Locale } from "@/i18n/config";

// The model gets the language name in English, which it follows most reliably.
const PROMPT_LANGUAGE_NAMES: Record<Locale, string> = {
  en: "English",
  de: "German",
};

/** Prompt line that makes the persona answer in the run's report language. */
export function reportLanguageInstruction(reportLanguage: Locale | undefined) {
  if (!reportLanguage) {
    return "";
  }

  return `Write every answer value in ${PROMPT_LANGUAGE_NAMES[reportLanguage]}. Keep the JSON keys and the verdict values exactly as specified, in English.`;
}
