import { describe, expect, it } from "vitest";

import { localizePersona, parsePersona } from "@/lib/personas";

const raw = [
  "---",
  "id: tom-thanks",
  "name: Tom Thanks",
  "voice: Warm",
  "experience_level: Mainstream user",
  "patience: High",
  "goals:",
  "  - Find the human story",
  "interests:",
  "  - Storytelling",
  "locales:",
  "  de:",
  "    summary: der Durchschnittstyp, den alle mögen",
  "    voice: Warmherzig",
  "    patience: Hoch",
  "    goals:",
  "      - Die menschliche Geschichte finden",
  "    unknown_field: ignored",
  "  fr:",
  "    voice: Chaleureux",
  "---",
  "You are Tom Hanks.",
].join("\n");

describe("parsePersona", () => {
  it("reads the localized display fields", () => {
    const persona = parsePersona(raw, "fallback");

    expect(persona.locales).toEqual({
      de: {
        summary: "der Durchschnittstyp, den alle mögen",
        voice: "Warmherzig",
        patience: "Hoch",
        goals: ["Die menschliche Geschichte finden"],
      },
    });
  });

  it("keeps the English base fields and the prompt", () => {
    const persona = parsePersona(raw, "fallback");

    expect(persona.voice).toBe("Warm");
    expect(persona.goals).toEqual(["Find the human story"]);
    expect(persona.prompt).toBe("You are Tom Hanks.");
  });

  it("defaults to no translations", () => {
    expect(parsePersona("---\nid: x\n---\nPrompt", "x").locales).toEqual({});
  });
});

describe("localizePersona", () => {
  const persona = parsePersona(raw, "fallback");

  it("overrides the translated fields and falls back to English for the rest", () => {
    const localized = localizePersona(persona, "de");

    expect(localized.voice).toBe("Warmherzig");
    expect(localized.patience).toBe("Hoch");
    expect(localized.goals).toEqual(["Die menschliche Geschichte finden"]);
    expect(localized.experienceLevel).toBe("Mainstream user");
    expect(localized.interests).toEqual(["Storytelling"]);
    expect(localized.summary).toBe("der Durchschnittstyp, den alle mögen");
  });

  it("never changes the prompt the agent receives", () => {
    expect(localizePersona(persona, "de").prompt).toBe(persona.prompt);
  });

  it("returns the base fields for English", () => {
    const localized = localizePersona(persona, "en");

    expect(localized.voice).toBe("Warm");
    expect(localized.summary).toBeUndefined();
  });
});
