import { describe, expect, it } from "vitest";

import {
  assertionAppliesTo,
  buildCellPlan,
  keepFieldsNotInForm,
  resolveStartArgs,
  DEFAULT_MAX_STEPS,
  EXPLORE_SCENARIO,
  isPersonaAssigned,
  matchesTarget,
  matchesTargetHost,
  parseScenario,
  resolveStartUrl,
  ScenarioValidationError,
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

describe("desktop scenarios", () => {
  const desktopSample: Scenario = {
    id: "export-report",
    title: "Export a report",
    mission: "Export the monthly report as PDF.",
    successCriteria: "The export dialog confirms the file was written",
    targetApp: "desktop-demo",
    startArgs: ["--profile", "Monthly Report", "--profile"],
    personaStartArgs: { "tom-thanks": ["--profile", "Tom"], "cardi-confused": [] as never },
    login: "auto",
    allowSubmit: true,
    maxSteps: 15,
    personas: [],
    assertions: [
      { type: "window_title_matches", value: "^Export( complete)?$" },
      { type: "text_visible", value: "Saved" },
    ],
  };

  const form = (entries: Record<string, string | string[]>) => {
    const data = new FormData();

    for (const [key, value] of Object.entries(entries)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        data.append(key, item);
      }
    }

    return data;
  };

  const base = { title: "Export", mission: "Export it.", successCriteria: "Exported" };

  it("round-trips target_app, start_args, persona_start_args and window_title_matches", () => {
    const raw = serializeScenario(desktopSample);

    expect(raw).toContain("target_app: desktop-demo");
    expect(raw).toContain("start_args:");
    expect(raw).toContain("persona_start_args:");
    // Empty argument lists are dropped when read back.
    expect(parseScenario(raw, "fallback")).toEqual({
      ...desktopSample,
      personaStartArgs: { "tom-thanks": ["--profile", "Tom"] },
    });
  });

  it("ignores persona_start_args that are not a map of lists", () => {
    const raw = "---\ntitle: X\npersona_start_args: [a, b]\n---\nDo it.\n";

    expect(parseScenario(raw, "x").personaStartArgs).toBeUndefined();
  });

  it("reads the app id and one start argument per line from the form", () => {
    const scenario = scenarioFromForm(
      form({ ...base, targetApp: " Desktop-Demo ", startArgs: "--lang de\r\n\n--profile x\n" }),
    );

    expect(scenario.targetApp).toBe("desktop-demo");
    expect(scenario.targetHost).toBeUndefined();
    expect(scenario.startArgs).toEqual(["--lang de", "--profile x"]);
  });

  it("leaves start args out when the field is empty", () => {
    expect(scenarioFromForm(form({ ...base, startArgs: "  " })).startArgs).toBeUndefined();
  });

  it("rejects a scenario with both a host and an app", () => {
    expect(() =>
      scenarioFromForm(form({ ...base, targetHost: "example.com", targetApp: "desktop-demo" })),
    ).toThrow(expect.objectContaining({ code: "hostAndApp" }));
  });

  it("rejects an app id with invalid characters", () => {
    const run = () => scenarioFromForm(form({ ...base, targetApp: "my app" }));

    expect(run).toThrow(ScenarioValidationError);
    expect(run).toThrow(expect.objectContaining({ code: "invalidAppId" }));
  });

  it("rejects an invalid window title regex", () => {
    expect(() =>
      scenarioFromForm(
        form({ ...base, assertionType: "window_title_matches", assertionValue: "Export (" }),
      ),
    ).toThrow(expect.objectContaining({ code: "invalidRegex", params: { value: "Export (" } }));
  });
});

describe("matchesTarget", () => {
  const web = { kind: "web" as const, url: "https://app.example.com/start" };
  const desktop = { kind: "desktop" as const, appId: "desktop-demo" };

  it("matches generic scenarios on every target", () => {
    expect(matchesTarget({}, web)).toBe(true);
    expect(matchesTarget({}, desktop)).toBe(true);
  });

  it("matches host scenarios only on web targets of that host", () => {
    expect(matchesTarget({ targetHost: "example.com" }, web)).toBe(true);
    expect(matchesTarget({ targetHost: "other.com" }, web)).toBe(false);
    expect(matchesTarget({ targetHost: "example.com" }, desktop)).toBe(false);
  });

  it("matches app scenarios only on that desktop app", () => {
    expect(matchesTarget({ targetApp: "desktop-demo" }, desktop)).toBe(true);
    expect(matchesTarget({ targetApp: "other-app" }, desktop)).toBe(false);
    expect(matchesTarget({ targetApp: "desktop-demo" }, web)).toBe(false);
  });
});

describe("assertionAppliesTo", () => {
  it("limits url and window title checks to their target kind", () => {
    expect(assertionAppliesTo("url_contains", "web")).toBe(true);
    expect(assertionAppliesTo("url_contains", "desktop")).toBe(false);
    expect(assertionAppliesTo("window_title_matches", "desktop")).toBe(true);
    expect(assertionAppliesTo("window_title_matches", "web")).toBe(false);
  });

  it("checks visible text on both target kinds", () => {
    expect(assertionAppliesTo("text_visible", "web")).toBe(true);
    expect(assertionAppliesTo("text_visible", "desktop")).toBe(true);
  });
});

describe("resolveStartArgs", () => {
  const scenario = { startArgs: ["--lang", "de"], personaStartArgs: { tom: ["--lang", "en"] } };

  it("uses the app defaults and the scenario args", () => {
    expect(resolveStartArgs({ appArgs: ["--test", "2"], scenario, personaId: "ann" })).toEqual([
      "--test",
      "2",
      "--lang",
      "de",
    ]);
  });

  it("lets persona args replace the defaults on both levels", () => {
    expect(
      resolveStartArgs({ appArgs: ["--test", "2"], personaArgs: ["--test", "7"], scenario, personaId: "tom" }),
    ).toEqual(["--test", "7", "--lang", "en"]);
  });

  it("works without any scenario args", () => {
    expect(resolveStartArgs({ appArgs: [], scenario: {}, personaId: "tom" })).toEqual([]);
  });
});

describe("keepFieldsNotInForm", () => {
  const existing: Scenario = {
    ...sample,
    targetHost: undefined,
    startPath: undefined,
    targetApp: "desktop-demo",
    startArgs: ["--lang", "de"],
    personaStartArgs: { tom: ["--lang", "en"] },
  };
  const fromForm: Scenario = { ...existing, targetApp: undefined, startArgs: undefined, personaStartArgs: undefined };

  it("keeps desktop fields the form did not send", () => {
    expect(keepFieldsNotInForm(fromForm, existing, new FormData())).toEqual(existing);
  });

  it("takes fields the form did send, even when emptied", () => {
    const data = new FormData();

    data.append("targetApp", "");
    data.append("startArgs", "");

    expect(keepFieldsNotInForm(fromForm, existing, data)).toMatchObject({
      targetApp: undefined,
      startArgs: undefined,
      personaStartArgs: { tom: ["--lang", "en"] },
    });
  });

  it("leaves new scenarios alone", () => {
    expect(keepFieldsNotInForm(fromForm, undefined, new FormData())).toBe(fromForm);
  });

  it("rejects a host from the form next to a kept app", () => {
    expect(() =>
      keepFieldsNotInForm({ ...fromForm, targetHost: "example.com" }, existing, new FormData()),
    ).toThrow(expect.objectContaining({ code: "hostAndApp" }));
  });
});
