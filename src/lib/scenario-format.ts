import matter from "gray-matter";

import {
  DEFAULT_MAX_STEPS,
  EXPLORE_SCENARIO_ID,
  MAX_STEPS_LIMIT,
  SCENARIO_ASSERTION_TYPES,
  SCENARIO_LOGIN_MODES,
  slugify,
  type Scenario,
  type ScenarioAssertion,
  type ScenarioAssertionType,
  type ScenarioLoginMode,
} from "@/lib/scenario-model";

export * from "@/lib/scenario-model";

type ScenarioFrontmatter = {
  id?: unknown;
  title?: unknown;
  success_criteria?: unknown;
  target_host?: unknown;
  start_path?: unknown;
  login?: unknown;
  allow_submit?: unknown;
  max_steps?: unknown;
  personas?: unknown;
  assertions?: unknown;
};

export function parseScenario(raw: string, fallbackId: string): Scenario {
  const { data, content } = matter(raw);
  const frontmatter = data as ScenarioFrontmatter;

  return {
    id: asText(frontmatter.id) || fallbackId,
    title: asText(frontmatter.title) || fallbackId,
    mission: content.trim(),
    successCriteria: asText(frontmatter.success_criteria),
    targetHost: asText(frontmatter.target_host) || undefined,
    startPath: asText(frontmatter.start_path) || undefined,
    login: asLoginMode(frontmatter.login),
    allowSubmit: frontmatter.allow_submit === true,
    maxSteps: asMaxSteps(frontmatter.max_steps),
    personas: asIdList(frontmatter.personas),
    assertions: asAssertions(frontmatter.assertions),
  };
}

export function serializeScenario(scenario: Scenario) {
  const frontmatter: Record<string, unknown> = {
    id: scenario.id,
    title: scenario.title,
    success_criteria: scenario.successCriteria,
  };

  if (scenario.targetHost) {
    frontmatter.target_host = scenario.targetHost;
  }

  if (scenario.startPath) {
    frontmatter.start_path = scenario.startPath;
  }

  frontmatter.login = scenario.login;
  frontmatter.allow_submit = scenario.allowSubmit;
  frontmatter.max_steps = scenario.maxSteps;

  if (scenario.personas?.length) {
    frontmatter.personas = [...scenario.personas];
  }

  if (scenario.assertions.length > 0) {
    frontmatter.assertions = scenario.assertions.map(({ type, value }) => ({ type, value }));
  }

  return matter.stringify(`${scenario.mission.trim()}\n`, frontmatter);
}

/** Builds a scenario from the /scenarios form. Throws with a user-facing message on bad input. */
export function scenarioFromForm(formData: FormData): Scenario {
  const title = formText(formData, "title");
  const mission = formText(formData, "mission");
  const successCriteria = formText(formData, "successCriteria");

  if (!title) {
    throw new Error("Please enter a title.");
  }

  if (!mission) {
    throw new Error("Please describe the mission.");
  }

  if (!successCriteria) {
    throw new Error("Please describe the success criterion.");
  }

  const id = formText(formData, "id") || slugify(title);

  if (!id) {
    throw new Error("The title must contain at least one letter or digit.");
  }

  if (id === EXPLORE_SCENARIO_ID) {
    throw new Error(`"${EXPLORE_SCENARIO_ID}" is reserved for the built-in free exploration.`);
  }

  const assertionTypes = formData.getAll("assertionType").map(String);
  const assertionValues = formData.getAll("assertionValue").map(String);

  return {
    id,
    title,
    mission,
    successCriteria,
    targetHost: normalizeHost(formText(formData, "targetHost")),
    startPath: normalizeStartPath(formText(formData, "startPath")),
    login: asLoginMode(formText(formData, "login")),
    allowSubmit: formData.get("allowSubmit") === "on",
    maxSteps: asMaxSteps(Number.parseInt(formText(formData, "maxSteps"), 10)),
    personas: asIdList(formData.getAll("assignedPersona")),
    assertions: asAssertions(
      assertionTypes.map((type, index) => ({ type, value: assertionValues[index] ?? "" })),
    ),
  };
}

function formText(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function normalizeHost(value: string) {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    throw new Error(`"${value}" is not a valid host.`);
  }
}

function normalizeStartPath(value: string) {
  if (!value) {
    return undefined;
  }

  return value.startsWith("/") ? value : `/${value}`;
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asLoginMode(value: unknown): ScenarioLoginMode {
  return SCENARIO_LOGIN_MODES.includes(value as ScenarioLoginMode)
    ? (value as ScenarioLoginMode)
    : "auto";
}

function asMaxSteps(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_MAX_STEPS;
  }

  return Math.min(value, MAX_STEPS_LIMIT);
}

function asIdList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map(asText).filter(Boolean))];
}

function asAssertions(value: unknown): ScenarioAssertion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const type = (item as { type?: unknown })?.type;
    const text = asText((item as { value?: unknown })?.value);

    if (!SCENARIO_ASSERTION_TYPES.includes(type as ScenarioAssertionType) || !text) {
      return [];
    }

    return [{ type: type as ScenarioAssertionType, value: text }];
  });
}
