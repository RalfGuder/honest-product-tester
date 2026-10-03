// Dependency-free scenario model, safe to import from client components.

export const DEFAULT_MAX_STEPS = 25;
export const MAX_STEPS_LIMIT = 100;
export const EXPLORE_SCENARIO_ID = "explore";

export const SCENARIO_LOGIN_MODES = ["auto", "required", "anonymous"] as const;
export const SCENARIO_ASSERTION_TYPES = ["url_contains", "text_visible"] as const;

export type ScenarioLoginMode = (typeof SCENARIO_LOGIN_MODES)[number];
export type ScenarioAssertionType = (typeof SCENARIO_ASSERTION_TYPES)[number];

export type ScenarioAssertion = {
  type: ScenarioAssertionType;
  value: string;
};

export type Scenario = {
  id: string;
  title: string;
  mission: string;
  successCriteria: string;
  targetHost?: string;
  startPath?: string;
  login: ScenarioLoginMode;
  allowSubmit: boolean;
  maxSteps: number;
  // Persona ids this scenario is meant for. Empty or missing = every persona.
  personas?: string[];
  assertions: ScenarioAssertion[];
};

// Built-in pseudo scenario: the original free exploration with the four insight questions.
export const EXPLORE_SCENARIO: Scenario = {
  id: EXPLORE_SCENARIO_ID,
  title: "Free exploration",
  mission: "",
  successCriteria: "",
  login: "auto",
  allowSubmit: false,
  maxSteps: DEFAULT_MAX_STEPS,
  personas: [],
  assertions: [],
};

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

export function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[äöüß]/g, (char) => UMLAUTS[char])
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

/** Scenarios without a target host are generic and match every run URL. */
export function matchesTargetHost(scenario: Pick<Scenario, "targetHost">, runUrl: string) {
  if (!scenario.targetHost) {
    return true;
  }

  let hostname: string;

  try {
    hostname = new URL(runUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  const target = scenario.targetHost.toLowerCase();

  return hostname === target || hostname.endsWith(`.${target}`);
}

export function isPersonaAssigned(scenario: Pick<Scenario, "personas">, personaId: string) {
  return !scenario.personas?.length || scenario.personas.includes(personaId);
}

/** The persona × scenario cells of a run: every selected persona with its assigned scenarios. */
export function buildCellPlan<S extends Pick<Scenario, "personas">>(
  personaIds: string[],
  scenarios: S[],
) {
  return personaIds.flatMap((personaId) =>
    scenarios
      .filter((scenario) => isPersonaAssigned(scenario, personaId))
      .map((scenario) => ({ personaId, scenario })),
  );
}

export function resolveStartUrl(runUrl: string, startPath: string | undefined) {
  return startPath ? new URL(startPath, runUrl).href : runUrl;
}
