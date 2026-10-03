import { promises as fs } from "node:fs";
import path from "node:path";

import {
  EXPLORE_SCENARIO,
  EXPLORE_SCENARIO_ID,
  parseScenario,
  ScenarioValidationError,
  serializeScenario,
  type Scenario,
} from "@/lib/scenario-format";
import { queueWrite } from "@/lib/write-queue";

const scenariosDir = path.join(process.cwd(), "scenarios");
const SCENARIO_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** All scenarios stored in scenarios/*.md, sorted by title. Excludes the built-in explore. */
export async function getScenarios(): Promise<Scenario[]> {
  let files: string[];

  try {
    files = await fs.readdir(scenariosDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const scenarios = await Promise.all(
    files
      .filter((file) => file.endsWith(".md"))
      .map(async (file) =>
        parseScenario(
          await fs.readFile(path.join(scenariosDir, file), "utf8"),
          path.basename(file, ".md"),
        ),
      ),
  );

  return scenarios.sort((left, right) => left.title.localeCompare(right.title));
}

export async function getScenario(id: string): Promise<Scenario | undefined> {
  if (id === EXPLORE_SCENARIO_ID) {
    return EXPLORE_SCENARIO;
  }

  try {
    return parseScenario(await fs.readFile(getScenarioPath(id), "utf8"), id);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

/** Creates or overwrites a scenario. With `mustBeNew`, refuses to overwrite an existing id. */
export async function saveScenario(scenario: Scenario, { mustBeNew = false } = {}) {
  const filePath = getScenarioPath(scenario.id);

  await queueWrite(`scenario:${scenario.id}`, async () => {
    await fs.mkdir(scenariosDir, { recursive: true });
    await fs.writeFile(filePath, serializeScenario(scenario), {
      encoding: "utf8",
      flag: mustBeNew ? "wx" : "w",
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") {
        throw new ScenarioValidationError(
          "alreadyExists",
          `A scenario with the id "${scenario.id}" already exists.`,
          { id: scenario.id },
        );
      }

      throw error;
    });
  });
}

export async function deleteScenario(id: string) {
  await queueWrite(`scenario:${id}`, () => fs.rm(getScenarioPath(id), { force: true }));
}

function getScenarioPath(id: string) {
  if (!SCENARIO_ID_PATTERN.test(id)) {
    throw new Error(`Invalid scenario id "${id}".`);
  }

  return path.join(scenariosDir, `${id}.md`);
}
