import { promises as fs } from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import { isLocale, type Locale } from "@/i18n/config";

export const defaultPersonaOrder = [
  "dark-muckerberg",
  "cardi-confused",
  "chef-lamb-sauce",
  "tom-thanks",
  "sir-stack-overflow",
  "multitasking-millie",
] as const;

const defaultPersonaOrderIndex = new Map<string, number>(
  defaultPersonaOrder.map((id, index) => [id, index]),
);

/** Display texts of a persona in another language. The agent prompt is never translated. */
export type PersonaTranslation = {
  summary?: string;
  voice?: string;
  experienceLevel?: string;
  patience?: string;
  goals?: string[];
  interests?: string[];
  dislikes?: string[];
  browseStyle?: string[];
};

export type Persona = {
  id: string;
  name: string;
  inspiredBy: string;
  avatar: string;
  voice: string;
  experienceLevel: string;
  patience: string;
  goals: string[];
  interests: string[];
  dislikes: string[];
  browseStyle: string[];
  reportSections: string[];
  prompt: string;
  locales: Partial<Record<Locale, PersonaTranslation>>;
};

export type LocalizedPersona = Persona & {
  // Short profile line in the requested language; undefined when the persona has none.
  summary?: string;
};

type PersonaFrontmatter = {
  id: string;
  name: string;
  inspired_by: string;
  avatar: string;
  voice: string;
  experience_level: string;
  patience: string;
  goals?: string[];
  interests?: string[];
  dislikes?: string[];
  browse_style?: string[];
  report_sections?: string[];
  locales?: Record<string, Record<string, unknown>>;
};

const personasDir = path.join(process.cwd(), "personas");

export function comparePersonaIds(leftId: string, rightId: string) {
  const leftIndex =
    defaultPersonaOrderIndex.get(leftId) ?? Number.MAX_SAFE_INTEGER;
  const rightIndex =
    defaultPersonaOrderIndex.get(rightId) ?? Number.MAX_SAFE_INTEGER;

  return leftIndex - rightIndex;
}

export function parsePersona(raw: string, fallbackId: string): Persona {
  const { data, content } = matter(raw);
  const frontmatter = data as PersonaFrontmatter;

  return {
    id: frontmatter.id?.trim() || fallbackId,
    name: frontmatter.name?.trim() || fallbackId,
    inspiredBy: frontmatter.inspired_by?.trim() || "Unknown",
    avatar: frontmatter.avatar?.trim() || "/personas/beginner.png",
    voice: frontmatter.voice?.trim() || "Direct",
    experienceLevel: frontmatter.experience_level?.trim() || "Unknown",
    patience: frontmatter.patience?.trim() || "Unknown",
    goals: frontmatter.goals ?? [],
    interests: frontmatter.interests ?? [],
    dislikes: frontmatter.dislikes ?? [],
    browseStyle: frontmatter.browse_style ?? [],
    reportSections: frontmatter.report_sections ?? [],
    prompt: content.trim(),
    locales: parseLocales(frontmatter.locales),
  };
}

/** Swaps in the translated display texts; anything not translated stays English. */
export function localizePersona(persona: Persona, locale: Locale): LocalizedPersona {
  const translation = persona.locales[locale] ?? {};

  return {
    ...persona,
    voice: translation.voice ?? persona.voice,
    experienceLevel: translation.experienceLevel ?? persona.experienceLevel,
    patience: translation.patience ?? persona.patience,
    goals: translation.goals ?? persona.goals,
    interests: translation.interests ?? persona.interests,
    dislikes: translation.dislikes ?? persona.dislikes,
    browseStyle: translation.browseStyle ?? persona.browseStyle,
    summary: translation.summary,
  };
}

export async function getPersonas(): Promise<Persona[]> {
  const files = await fs.readdir(personasDir);
  const markdownFiles = files.filter((file) => file.endsWith(".md")).sort();

  const personas = await Promise.all(
    markdownFiles.map(async (file) =>
      parsePersona(
        await fs.readFile(path.join(personasDir, file), "utf8"),
        path.basename(file, ".md"),
      ),
    ),
  );

  return personas.sort((left, right) => {
    const indexDelta = comparePersonaIds(left.id, right.id);

    if (indexDelta !== 0) {
      return indexDelta;
    }

    return left.name.localeCompare(right.name);
  });
}

function parseLocales(value: PersonaFrontmatter["locales"]) {
  const locales: Persona["locales"] = {};

  for (const [locale, fields] of Object.entries(value ?? {})) {
    if (!isLocale(locale) || typeof fields !== "object" || fields === null) {
      continue;
    }

    const translation: PersonaTranslation = {};
    const text = (key: string) =>
      typeof fields[key] === "string" && fields[key].trim() ? fields[key].trim() : undefined;
    const list = (key: string) =>
      Array.isArray(fields[key])
        ? fields[key].filter((item): item is string => typeof item === "string")
        : undefined;

    assignDefined(translation, "summary", text("summary"));
    assignDefined(translation, "voice", text("voice"));
    assignDefined(translation, "experienceLevel", text("experience_level"));
    assignDefined(translation, "patience", text("patience"));
    assignDefined(translation, "goals", list("goals"));
    assignDefined(translation, "interests", list("interests"));
    assignDefined(translation, "dislikes", list("dislikes"));
    assignDefined(translation, "browseStyle", list("browse_style"));

    locales[locale] = translation;
  }

  return locales;
}

function assignDefined<K extends keyof PersonaTranslation>(
  target: PersonaTranslation,
  key: K,
  value: PersonaTranslation[K] | undefined,
) {
  if (value !== undefined) {
    target[key] = value;
  }
}
