import { describe, expect, it } from "vitest";

import {
  buildCellPlan,
  DEFAULT_MAX_STEPS,
  EXPLORE_SCENARIO,
  isPersonaAssigned,
  matchesTargetHost,
  parseScenario,
  resolveStartUrl,
  scenarioFromForm,
  serializeScenario,
  slugify,
  type Scenario,
} from "@/lib/scenario-format";

const sample: Scenario = {
  id: "save-favorite",
  title: "Save a recipe as a favorite",
  mission: "You want to find a recipe for dinner and save it for later.",
  successCriteria: "The recipe appears in the favorites list",
  targetHost: "recipes.example.com",
  startPath: "/recipes",
  login: "required",
  allowSubmit: true,
  maxSteps: 12,
  personas: ["sir-stack-overflow", "tom-thanks"],
  assertions: [
    { type: "url_contains", value: "/favorites" },
    { type: "text_visible", value: "Saved" },
  ],
};

describe("slugify", () => {
  it("lowercases and joins words with dashes", () => {
    expect(slugify("Save a Recipe as Favorite!")).toBe("save-a-recipe-as-favorite");
  });

  it("transliterates German umlauts", () => {
    expect(slugify("Größe ändern über Menü")).toBe("groesse-aendern-ueber-menue");
  });

  it("trims dashes and caps the length", () => {
    expect(slugify("  --Hello--  ")).toBe("hello");
    expect(slugify("a".repeat(100)).length).toBe(60);
  });
});

describe("serializeScenario / parseScenario", () => {
  it("round-trips every field", () => {
    expect(parseScenario(serializeScenario(sample), "fallback")).toEqual(sample);
  });

  it("omits optional fields that are empty", () => {
    const raw = serializeScenario({
      ...sample,
      targetHost: undefined,
      startPath: undefined,
      personas: [],
      assertions: [],
    });

    expect(raw).not.toContain("personas");
    expect(raw).not.toContain("target_host");
    expect(raw).not.toContain("start_path");
    expect(raw).not.toContain("assertions");
  });

  it("applies defaults for missing front matter", () => {
    const parsed = parseScenario("---\ntitle: Minimal\n---\nDo the thing.\n", "minimal");

    expect(parsed).toEqual({
      id: "minimal",
      title: "Minimal",
      mission: "Do the thing.",
      successCriteria: "",
      targetHost: undefined,
      startPath: undefined,
      login: "auto",
      allowSubmit: false,
      maxSteps: DEFAULT_MAX_STEPS,
      personas: [],
      assertions: [],
    });
  });

  it("keeps only non-empty, unique persona ids", () => {
    const parsed = parseScenario(
      ["---", "title: P", "personas:", "  - tom-thanks", "  - ''", "  - 42", "  - tom-thanks", "---", "M"].join("\n"),
      "p",
    );

    expect(parsed.personas).toEqual(["tom-thanks"]);
  });

  it("drops unknown login modes and invalid assertions", () => {
    const parsed = parseScenario(
      [
        "---",
        "title: Bad",
        "login: sometimes",
        "max_steps: -4",
        "assertions:",
        "  - type: url_contains",
        "    value: /ok",
        "  - type: eval",
        "    value: alert(1)",
        "  - type: text_visible",
        "    value: ''",
        "---",
        "Mission",
      ].join("\n"),
      "bad",
    );

    expect(parsed.login).toBe("auto");
    expect(parsed.maxSteps).toBe(DEFAULT_MAX_STEPS);
    expect(parsed.assertions).toEqual([{ type: "url_contains", value: "/ok" }]);
  });
});

describe("scenarioFromForm", () => {
  const form = (entries: Record<string, string | string[]>) => {
    const data = new FormData();

    for (const [key, value] of Object.entries(entries)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        data.append(key, item);
      }
    }

    return data;
  };

  it("builds a scenario and derives the id from the title", () => {
    const scenario = scenarioFromForm(
      form({
        title: "Find Pricing",
        mission: "Find out what it costs.",
        successCriteria: "A price is visible",
        targetHost: "https://Shop.Example.com/path",
        startPath: "pricing",
        login: "anonymous",
        maxSteps: "8",
        assertionType: ["url_contains", "text_visible"],
        assertionValue: ["/pricing", ""],
      }),
    );

    expect(scenario).toEqual({
      id: "find-pricing",
      title: "Find Pricing",
      mission: "Find out what it costs.",
      successCriteria: "A price is visible",
      targetHost: "shop.example.com",
      startPath: "/pricing",
      login: "anonymous",
      allowSubmit: false,
      maxSteps: 8,
      personas: [],
      assertions: [{ type: "url_contains", value: "/pricing" }],
    });
  });

  it("reads the assigned personas", () => {
    const scenario = scenarioFromForm(
      form({
        title: "Admin",
        mission: "m",
        successCriteria: "c",
        assignedPersona: ["sir-stack-overflow", "dark-muckerberg"],
      }),
    );

    expect(scenario.personas).toEqual(["sir-stack-overflow", "dark-muckerberg"]);
  });

  it("keeps an existing id when editing", () => {
    const scenario = scenarioFromForm(
      form({ id: "old-id", title: "New title", mission: "m", successCriteria: "c" }),
    );

    expect(scenario.id).toBe("old-id");
  });

  it("rejects missing required fields", () => {
    expect(() => scenarioFromForm(form({ title: "", mission: "m", successCriteria: "c" }))).toThrow(
      /title/i,
    );
    expect(() => scenarioFromForm(form({ title: "t", mission: "", successCriteria: "c" }))).toThrow(
      /mission/i,
    );
    expect(() => scenarioFromForm(form({ title: "t", mission: "m", successCriteria: "" }))).toThrow(
      /success/i,
    );
  });

  it("rejects the reserved explore id", () => {
    expect(() =>
      scenarioFromForm(form({ title: "Explore", mission: "m", successCriteria: "c" })),
    ).toThrow(/reserved/i);
  });
});

describe("matchesTargetHost", () => {
  it("treats scenarios without host as generic", () => {
    expect(matchesTargetHost({ targetHost: undefined }, "https://any.site")).toBe(true);
  });

  it("matches host and subdomains case-insensitively", () => {
    expect(matchesTargetHost({ targetHost: "example.com" }, "https://EXAMPLE.com/x")).toBe(true);
    expect(matchesTargetHost({ targetHost: "example.com" }, "https://www.example.com")).toBe(true);
    expect(matchesTargetHost({ targetHost: "example.com" }, "https://notexample.com")).toBe(false);
  });

  it("returns false for unparsable URLs", () => {
    expect(matchesTargetHost({ targetHost: "example.com" }, "not a url")).toBe(false);
  });
});

describe("resolveStartUrl", () => {
  it("returns the run URL without a start path", () => {
    expect(resolveStartUrl("https://example.com/app", undefined)).toBe("https://example.com/app");
  });

  it("resolves the start path against the run origin", () => {
    expect(resolveStartUrl("https://example.com/app?x=1", "/favorites")).toBe(
      "https://example.com/favorites",
    );
  });
});

describe("isPersonaAssigned", () => {
  it("assigns every persona when the list is empty or missing", () => {
    expect(isPersonaAssigned({ personas: [] }, "tom-thanks")).toBe(true);
    expect(isPersonaAssigned({ personas: undefined }, "tom-thanks")).toBe(true);
  });

  it("assigns only listed personas", () => {
    expect(isPersonaAssigned({ personas: ["tom-thanks"] }, "tom-thanks")).toBe(true);
    expect(isPersonaAssigned({ personas: ["tom-thanks"] }, "cardi-confused")).toBe(false);
  });
});

describe("buildCellPlan", () => {
  const admin = { ...sample, id: "admin", personas: ["sir-stack-overflow"] };

  it("pairs every selected persona with the scenarios assigned to it", () => {
    const plan = buildCellPlan(["tom-thanks", "sir-stack-overflow"], [EXPLORE_SCENARIO, admin]);

    expect(plan.map(({ personaId, scenario }) => `${personaId}:${scenario.id}`)).toEqual([
      "tom-thanks:explore",
      "sir-stack-overflow:explore",
      "sir-stack-overflow:admin",
    ]);
  });

  it("returns no cells when no selected persona is assigned", () => {
    expect(buildCellPlan(["tom-thanks"], [admin])).toEqual([]);
  });
});
