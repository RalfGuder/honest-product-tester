import { promises as fs } from "node:fs";
import path from "node:path";

import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import type { LiveText } from "@/i18n/live";
import { buildQueuedReportMarkdown } from "@/lib/report-markdown";
import { comparePersonaIds, Persona } from "@/lib/personas";
import type { PersonaReportInsight } from "@/lib/report-insights";
import {
  buildCellPlan,
  EXPLORE_SCENARIO,
  EXPLORE_SCENARIO_ID,
  type Scenario,
} from "@/lib/scenario-format";
import type { CellReport } from "@/lib/scenario-verdict";
import { queueWrite } from "@/lib/write-queue";

type OrchestrationMode = "sequential" | "parallel";

export type RunStatus = "queued" | "running" | "completed" | "failed";
export type CellRunStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export type RunManifest = {
  id: string;
  url: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  status: RunStatus;
  orchestration: OrchestrationMode;
  personas: string[];
  // Snapshot of the scenarios at run start. Missing in runs created before scenarios existed.
  scenarios?: Scenario[];
  // Language the personas answer in. Missing in runs created before reports were localized.
  reportLanguage?: Locale;
  currentPersonaId?: string;
  error?: string;
};

export type PersonaAction = {
  at: string;
  tool: string;
  input: string;
  outcome: "success" | "error";
};

/** One persona working through one scenario. */
export type CellRunRecord = {
  cellId: string;
  personaId: string;
  personaName: string;
  personaAvatar: string;
  scenarioId: string;
  scenarioTitle: string;
  status: CellRunStatus;
  summary: LiveText;
  reportPath: string;
  observations: LiveText[];
  actions: PersonaAction[];
  latestScreenshotFileName?: string;
  latestScreenshotTakenAt?: string;
  // Free exploration only: the four insight answers.
  structuredSummary?: PersonaReportInsight[];
  // Mission scenarios only: verdict and evidence.
  cellReport?: CellReport;
  finalReport?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
};

const runsDir = path.join(process.cwd(), "data", "runs");

export function getCellId(personaId: string, scenarioId: string) {
  return `${personaId}__${scenarioId}`;
}

/** Scenarios of a run; runs created before scenarios existed were free exploration only. */
export function getRunScenarios(manifest: RunManifest) {
  return manifest.scenarios?.length ? manifest.scenarios : [EXPLORE_SCENARIO];
}

export async function createRun(
  url: string,
  personas: Persona[],
  scenarios: Scenario[],
  reportLanguage?: Locale,
) {
  const trimmedUrl = url.trim();
  const parsedUrl = validatePublicUrl(trimmedUrl);

  if (personas.length === 0) {
    throw new Error("Select at least one persona.");
  }

  if (scenarios.length === 0) {
    throw new Error("Select at least one scenario.");
  }

  const cellPlan = buildCellPlan(
    personas.map((persona) => persona.id),
    scenarios,
  );

  if (cellPlan.length === 0) {
    throw new Error("None of the selected testers is assigned to the selected scenarios.");
  }

  const personasById = new Map(personas.map((persona) => [persona.id, persona]));

  const runId = createRunId();
  const runDir = path.join(runsDir, runId);

  const manifest: RunManifest = {
    id: runId,
    url: parsedUrl.href,
    createdAt: new Date().toISOString(),
    status: "queued",
    orchestration: "parallel",
    personas: personas.map((persona) => persona.id),
    scenarios,
    reportLanguage,
  };

  await fs.mkdir(path.join(runDir, "cells"), { recursive: true });
  await fs.mkdir(path.join(runDir, "screenshots"), { recursive: true });
  await writeManifest(runId, manifest);

  const t = getDictionary(reportLanguage ?? "en");

  await Promise.all(
    cellPlan.map(async ({ personaId, scenario }) => {
      const persona = personasById.get(personaId)!;
      const cellId = getCellId(persona.id, scenario.id);
      const record: CellRunRecord = {
        cellId,
        personaId: persona.id,
        personaName: persona.name,
        personaAvatar: persona.avatar,
        scenarioId: scenario.id,
        scenarioTitle: scenario.title,
        status: "queued",
        summary: { key: "runCreated" },
        reportPath: path.join("cells", `${cellId}.md`),
        observations: [
          { key: "personaLoaded" },
          { key: "scenarioNamed", params: { title: scenario.title, scenarioId: scenario.id } },
          { key: "browserNotStarted" },
        ],
        actions: [],
      };

      await writeCellRecord(runId, cellId, record);
      await writeCellReport(
        runId,
        cellId,
        buildQueuedReportMarkdown(
          t,
          scenario.id === EXPLORE_SCENARIO_ID
            ? persona.name
            : `${persona.name} – ${scenario.title}`,
        ),
      );
    }),
  );

  return manifest;
}

export async function getRun(runId: string) {
  const manifest = await readManifest(runId);
  const cellDir = path.join(runsDir, runId, "cells");
  const legacy = !(await exists(cellDir));
  const recordDir = legacy ? path.join(runsDir, runId, "personas") : cellDir;
  const recordFiles = (await fs.readdir(recordDir)).filter((file) => file.endsWith(".json"));

  const cells = await Promise.all(
    recordFiles.map(async (file) => {
      const record = JSON.parse(
        await fs.readFile(path.join(recordDir, file), "utf8"),
      ) as CellRunRecord;

      return legacy ? upgradeLegacyRecord(record) : record;
    }),
  );

  const scenarioOrder = getRunScenarios(manifest).map((scenario) => scenario.id);

  cells.sort(
    (left, right) =>
      comparePersonaIds(left.personaId, right.personaId) ||
      left.personaName.localeCompare(right.personaName) ||
      scenarioOrder.indexOf(left.scenarioId) - scenarioOrder.indexOf(right.scenarioId),
  );

  return {
    manifest,
    cells,
  };
}

export async function updateRunManifest(
  runId: string,
  updater: (current: RunManifest) => RunManifest,
) {
  return queueWrite(`manifest:${runId}`, async () => {
    const current = await readManifest(runId);
    const next = updater(current);
    await writeManifest(runId, next);
    return next;
  });
}

export async function updateCellRecord(
  runId: string,
  cellId: string,
  updater: (current: CellRunRecord) => CellRunRecord,
) {
  return queueWrite(`cell:${runId}:${cellId}`, async () => {
    const current = await readCellRecord(runId, cellId);
    const next = updater(current);
    await writeCellRecord(runId, cellId, next);
    return next;
  });
}

export async function appendCellObservation(
  runId: string,
  cellId: string,
  observation: LiveText,
) {
  return updateCellRecord(runId, cellId, (current) => ({
    ...current,
    observations: [observation, ...current.observations].slice(0, 12),
  }));
}

export async function appendCellAction(runId: string, cellId: string, action: PersonaAction) {
  return updateCellRecord(runId, cellId, (current) => ({
    ...current,
    actions: [action, ...current.actions].slice(0, 20),
  }));
}

export async function writeCellReport(runId: string, cellId: string, markdown: string) {
  await fs.writeFile(path.join(runsDir, runId, "cells", `${cellId}.md`), markdown, "utf8");
}

/** Keeps the persona's raw final answer(s) next to the report, so parse failures can be traced. */
export async function writeCellRawOutput(runId: string, cellId: string, attempts: string[]) {
  const content = attempts
    .map((text, index) => `=== ${index === 0 ? "final answer" : `repair ${index}`} ===\n${text}\n`)
    .join("\n");

  await fs.writeFile(path.join(runsDir, runId, "cells", `${cellId}.raw.txt`), content, "utf8");
}

export function getScreenshotDir(runId: string) {
  return path.join(runsDir, runId, "screenshots");
}

function upgradeLegacyRecord(record: CellRunRecord): CellRunRecord {
  return {
    ...record,
    cellId: getCellId(record.personaId, EXPLORE_SCENARIO_ID),
    scenarioId: EXPLORE_SCENARIO_ID,
    scenarioTitle: EXPLORE_SCENARIO.title,
  };
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(runId: string) {
  const manifestPath = path.join(runsDir, runId, "manifest.json");
  return JSON.parse(await fs.readFile(manifestPath, "utf8")) as RunManifest;
}

async function writeManifest(runId: string, manifest: RunManifest) {
  const manifestPath = path.join(runsDir, runId, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

async function readCellRecord(runId: string, cellId: string) {
  const recordPath = path.join(runsDir, runId, "cells", `${cellId}.json`);
  return JSON.parse(await fs.readFile(recordPath, "utf8")) as CellRunRecord;
}

async function writeCellRecord(runId: string, cellId: string, record: CellRunRecord) {
  const recordPath = path.join(runsDir, runId, "cells", `${cellId}.json`);
  await fs.writeFile(
    recordPath,
    JSON.stringify(
      {
        ...record,
        updatedAt: new Date().toISOString(),
      } satisfies CellRunRecord,
      null,
      2,
    ),
    "utf8",
  );
}

function createRunId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `run-${timestamp}-${suffix}`;
}

function validatePublicUrl(rawUrl: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("Please enter a valid absolute URL.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }

  if (!parsedUrl.hostname) {
    throw new Error("Please enter a valid public website URL.");
  }

  return parsedUrl;
}
