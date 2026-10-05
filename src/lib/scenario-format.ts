import matter from "gray-matter";

import {
  APP_ID_PATTERN,
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

export type ScenarioErrorCode =
  | "titleRequired"
  | "missionRequired"
  | "successCriteriaRequired"
  | "titleWithoutSlug"
  | "reservedId"
  | "invalidHost"
  | "invalidAppId"
  | "hostAndApp"
  | "invalidRegex"
  | "alreadyExists";

/** A user-facing validation error; the UI translates it by `code`. The message stays English. */
export class ScenarioValidationError extends Error {
  constructor(
    readonly code: ScenarioErrorCode,
    message: string,
    readonly params: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ScenarioValidationError";
  }
}

type ScenarioFrontmatter = {
  id?: unknown;
  title?: unknown;
  success_criteria?: unknown;
  target_host?: unknown;
  start_path?: unknown;
  target_app?: unknown;
  start_args?: unknown;
  persona_start_args?: unknown;
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
    targetApp: asText(frontmatter.target_app) || undefined,
    startArgs: asTextList(frontmatter.start_args),
    personaStartArgs: asArgsByPersona(frontmatter.persona_start_args),
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

  if (scenario.targetApp) {
    frontmatter.target_app = scenario.targetApp;
  }

  if (scenario.startArgs?.length) {
    frontmatter.start_args = [...scenario.startArgs];
  }

  if (scenario.personaStartArgs && Object.keys(scenario.personaStartArgs).length > 0) {
    frontmatter.persona_start_args = Object.fromEntries(
      Object.entries(scenario.personaStartArgs).map(([personaId, args]) => [personaId, [...args]]),
    );
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
    throw new ScenarioValidationError("titleRequired", "Please enter a title.");
  }

  if (!mission) {
    throw new ScenarioValidationError("missionRequired", "Please describe the mission.");
  }

  if (!successCriteria) {
    throw new ScenarioValidationError(
      "successCriteriaRequired",
      "Please describe the success criterion.",
    );
  }

  const id = formText(formData, "id") || slugify(title);

  if (!id) {
    throw new ScenarioValidationError(
      "titleWithoutSlug",
      "The title must contain at least one letter or digit.",
    );
  }

  if (id === EXPLORE_SCENARIO_ID) {
    throw new ScenarioValidationError(
      "reservedId",
      `"${EXPLORE_SCENARIO_ID}" is reserved for the built-in free exploration.`,
      { id: EXPLORE_SCENARIO_ID },
    );
  }

  const targetHost = normalizeHost(formText(formData, "targetHost"));
  const targetApp = normalizeAppId(formText(formData, "targetApp"));

  if (targetHost && targetApp) {
    throw new ScenarioValidationError(
      "hostAndApp",
      "A scenario targets either a website host or a desktop app, not both.",
    );
  }

  const assertionTypes = formData.getAll("assertionType").map(String);
  const assertionValues = formData.getAll("assertionValue").map(String);
  const assertions = asAssertions(
    assertionTypes.map((type, index) => ({ type, value: assertionValues[index] ?? "" })),
  );

  assertions
    .filter((assertion) => assertion.type === "window_title_matches")
    .forEach(({ value }) => assertRegex(value));

  return {
    id,
    title,
    mission,
    successCriteria,
    targetHost,
    startPath: normalizeStartPath(formText(formData, "startPath")),
    targetApp,
    // One argument per line, so arguments may contain spaces.
    startArgs: asTextList(formText(formData, "startArgs").split(/\r?\n/)),
    login: asLoginMode(formText(formData, "login")),
    allowSubmit: formData.get("allowSubmit") === "on",
    maxSteps: asMaxSteps(Number.parseInt(formText(formData, "maxSteps"), 10)),
    personas: asIdList(formData.getAll("assignedPersona")),
    assertions,
  };
}

/**
 * The form only shows some fields. When an existing scenario is saved, keep the fields the
 * form did not send, so desktop settings written in the file survive an edit in the UI.
 */
export function keepFieldsNotInForm(
  scenario: Scenario,
  existing: Scenario | undefined,
  formData: FormData,
): Scenario {
  if (!existing) {
    return scenario;
  }

  const merged: Scenario = {
    ...scenario,
    targetApp: formData.has("targetApp") ? scenario.targetApp : existing.targetApp,
    startArgs: formData.has("startArgs") ? scenario.startArgs : existing.startArgs,
    personaStartArgs: existing.personaStartArgs,
  };

  if (merged.targetHost && merged.targetApp) {
    throw new ScenarioValidationError(
      "hostAndApp",
      "A scenario targets either a website host or a desktop app, not both.",
    );
  }

  return merged;
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
    throw new ScenarioValidationError("invalidHost", `"${value}" is not a valid host.`, { value });
  }
}

function normalizeAppId(value: string) {
  if (!value) {
    return undefined;
  }

  const appId = value.toLowerCase();

  if (!APP_ID_PATTERN.test(appId)) {
    throw new ScenarioValidationError("invalidAppId", `"${value}" is not a valid app id.`, {
      value,
    });
  }

  return appId;
}

function assertRegex(value: string) {
  try {
    new RegExp(value);
  } catch {
    throw new ScenarioValidationError(
      "invalidRegex",
      `"${value}" is not a valid regular expression.`,
      { value },
    );
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

// Keeps order and duplicates: command line arguments may repeat. Empty lists are left out.
function asTextList(value: unknown) {
  const items = Array.isArray(value) ? value.map(asText).filter(Boolean) : [];

  return items.length > 0 ? items : undefined;
}

function asArgsByPersona(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>).flatMap(([personaId, args]) => {
    const list = asTextList(args);
    const id = personaId.trim();

    return id && list ? [[id, list] as const] : [];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
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
