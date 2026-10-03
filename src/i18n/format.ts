import type { Locale } from "@/i18n/config";

export type PluralForms = {
  one: string;
  other: string;
};

/** Replaces `{name}` placeholders; unknown placeholders stay visible so gaps are easy to spot. */
export function format(template: string, params: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

export function plural(
  locale: Locale,
  forms: PluralForms,
  count: number,
  params: Record<string, string | number> = {},
) {
  const rule = new Intl.PluralRules(locale).select(count);
  const template = rule === "one" ? forms.one : forms.other;

  return format(template, { ...params, count });
}
