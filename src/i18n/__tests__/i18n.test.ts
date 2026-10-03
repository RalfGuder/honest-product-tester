import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, isLocale, matchLocale, resolveLocale } from "@/i18n/config";
import { de } from "@/i18n/dictionaries/de";
import { en } from "@/i18n/dictionaries/en";
import { format, plural } from "@/i18n/format";
import { reportLanguageInstruction } from "@/lib/report-language";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function placeholders(value: unknown): Record<string, string[]> {
  return Object.fromEntries(
    keyPaths(value).map((path) => {
      const text = path.split(".").reduce<unknown>(
        (node, key) => (node as Record<string, unknown>)[key],
        value,
      );

      return [path, [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()];
    }),
  );
}

describe("dictionaries", () => {
  it("have exactly the same keys in German and English", () => {
    expect(keyPaths(de).sort()).toEqual(keyPaths(en).sort());
  });

  it("use the same placeholders in both languages", () => {
    expect(placeholders(de)).toEqual(placeholders(en));
  });

  it("contain no empty texts", () => {
    for (const dictionary of [en, de]) {
      for (const [path, text] of Object.entries(placeholders(dictionary))) {
        expect(text, path).toBeDefined();
      }

      expect(JSON.stringify(dictionary)).not.toMatch(/:""/);
    }
  });
});

describe("isLocale", () => {
  it("accepts only supported locales", () => {
    expect(isLocale("de")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("matchLocale", () => {
  it("picks the highest-ranked supported language", () => {
    expect(matchLocale("fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7")).toBe("de");
    expect(matchLocale("en-US,en;q=0.9,de;q=0.8")).toBe("en");
    expect(matchLocale("de-AT")).toBe("de");
  });

  it("respects q-values regardless of order", () => {
    expect(matchLocale("en;q=0.3,de;q=0.9")).toBe("de");
  });

  it("falls back to the default locale", () => {
    expect(matchLocale("fr,it")).toBe(DEFAULT_LOCALE);
    expect(matchLocale(null)).toBe(DEFAULT_LOCALE);
    expect(matchLocale("")).toBe(DEFAULT_LOCALE);
  });
});

describe("resolveLocale", () => {
  it("prefers a valid cookie over the browser language", () => {
    expect(resolveLocale("de", "en-US")).toBe("de");
  });

  it("ignores an invalid cookie", () => {
    expect(resolveLocale("xx", "de-DE")).toBe("de");
  });
});

describe("format", () => {
  it("replaces named placeholders", () => {
    expect(format("{a} and {b}", { a: 1, b: "two" })).toBe("1 and two");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(format("Hi {name}", {})).toBe("Hi {name}");
  });
});

describe("plural", () => {
  const forms = { one: "{count} run", other: "{count} runs" };

  it("chooses the form for the count", () => {
    expect(plural("en", forms, 1)).toBe("1 run");
    expect(plural("en", forms, 3)).toBe("3 runs");
    expect(plural("de", { one: "{count} Lauf", other: "{count} Läufe" }, 0)).toBe("0 Läufe");
  });
});

describe("reportLanguageInstruction", () => {
  it("names the language in English for the model", () => {
    expect(reportLanguageInstruction("de")).toMatch(/German/);
    expect(reportLanguageInstruction("en")).toMatch(/English/);
  });

  it("keeps JSON keys and verdicts in English", () => {
    expect(reportLanguageInstruction("de")).toMatch(/keys/i);
  });

  it("is empty when no report language is set", () => {
    expect(reportLanguageInstruction(undefined)).toBe("");
  });
});
