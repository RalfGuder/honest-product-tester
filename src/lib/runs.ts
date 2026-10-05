import { promises as fs } from "node:fs";
import path from "node:path";

import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import type { LiveText } from "@/i18n/live";
import { buildQueuedReportMarkdown } from "@/lib/report-markdown";
import { getDesktopApp } from "@/lib/desktop-apps";
import type { DesktopTarget, RunTarget, RunTargetInput } from "@/lib/run-target";
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

export type { DesktopTarget, RunTarget, RunTargetInput, WebTarget } from "@/lib/run-target";

type OrchestrationMode = "sequential" | "parallel";

export type RunStatus = "queued" | "running" | "completed" | "failed";
export type CellRunStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export type RunManifest = {
  id: string;
  target: RunTarget;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  status: RunStatus;
  orchestration: OrchestrationMode;
  personas: string[];
  // Snapshot of the scenarios at run start. Missing in runs created before scenarios existed.
  scenarios?: Scenario[];
  // Testers working at the same time. Missing = no limit (web); desktop runs default to 1.
  maxParallel?: number;
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
  targetInput: RunTargetInput,
  personas: Persona[],
  scenarios: Scenario[],
  reportLanguage?: Locale,
) {
  const target = await resolveTarget(targetInput);

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
    target,
    maxParallel: targetInput.kind === "desktop" ? (targetInput.maxParallel ?? 1) : undefined,
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
  return upgradeManifest(JSON.parse(await fs.readFile(manifestPath, "utf8")));
}

/** Runs created before desktop targets existed only stored the website URL. */
export function upgradeManifest(raw: RunManifest | (Omit<RunManifest, "target"> & { url: string })) {
  if ("target" in raw && raw.target) {
    return raw as RunManifest;
  }

  const { url, ...rest } = raw as Omit<RunManifest, "target"> & { url: string };

  return { ...rest, target: { kind: "web", url } } satisfies RunManifest;
}

async function writeManifest(runId: string, manifest: RunManifest) {
  const manifestPath = path.join(runsDir, runId, "manifest.json");
  await writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2));
}

const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_MS = 20;

// The run page polls these JSON files while the executor rewrites them. A plain writeFile
// truncates first, so a concurrent read could parse half a file and the API answered 404.
// Writing a temp file and renaming it swaps the content in one step.
async function writeFileAtomic(filePath: string, content: string) {
  const tempPath = `${filePath}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tempPath, content, "utf8");

  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      // Windows refuses the rename while a reader holds the target open; that is brief.
      const code = (error as NodeJS.ErrnoException).code;

      if ((code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") || attempt === RENAME_ATTEMPTS) {
        await fs.rm(tempPath, { force: true });
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_MS * attempt));
    }
  }
}

async function readCellRecord(runId: string, cellId: string) {
  const recordPath = path.join(runsDir, runId, "cells", `${cellId}.json`);
  return JSON.parse(await fs.readFile(recordPath, "utf8")) as CellRunRecord;
}

async function writeCellRecord(runId: string, cellId: string, record: CellRunRecord) {
  const recordPath = path.join(runsDir, runId, "cells", `${cellId}.json`);
  await writeFileAtomic(
    recordPath,
    JSON.stringify(
      {
        ...record,
        updatedAt: new Date().toISOString(),
      } satisfies CellRunRecord,
      null,
      2,
    ),
  );
}

function createRunId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `run-${timestamp}-${suffix}`;
}

async function resolveTarget(input: RunTargetInput): Promise<RunTarget> {
  if (input.kind === "web") {
    return { kind: "web", url: validatePublicUrl(input.url.trim()).href };
  }

  return validateDesktopTarget(input.appId);
}

async function validateDesktopTarget(appId: string): Promise<DesktopTarget> {
  const app = await getDesktopApp(appId.trim());

  if (!app) {
    throw new Error(`Desktop app "${appId}" is not in the allowlist.`);
  }

  return {
    kind: "desktop",
    appId: app.id,
    appName: app.name,
    exePath: app.exePath,
    args: app.defaultArgs,
    workingDir: app.workingDir,
  };
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
