import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";

import type { Locale } from "@/i18n/config";
import { renderLiveText, type LiveMessage } from "@/i18n/live";
import { en, type Dictionary } from "@/i18n/dictionaries/en";
import { getPersonas, type Persona } from "@/lib/personas";
import { getDictionary } from "@/i18n/dictionaries";
import {
  buildCellReportMarkdown,
  buildFailedReportMarkdown,
  buildSummaryMarkdown,
} from "@/lib/report-markdown";
import {
  appendCellObservation,
  getCellId,
  getRun,
  getRunScenarios,
  getScreenshotDir,
  updateCellRecord,
  type RunTarget,
  updateRunManifest,
  writeCellRawOutput,
  writeCellReport,
} from "@/lib/runs";
import { createIdleWatchdog } from "@/lib/idle-watchdog";
import { buildRepairPrompt, parseWithRepair, type ParseOutcome } from "@/lib/report-parsing";
import {
  REPORT_INSIGHT_DEFINITIONS,
  type PersonaReportInsight,
} from "@/lib/report-insights";
import {
  EXPLORE_SCENARIO_ID,
  assertionAppliesTo,
  isPersonaAssigned,
  resolveStartUrl,
  type Scenario,
  type ScenarioAssertion,
} from "@/lib/scenario-format";
import {
  createStepBudget,
  parseCellReport,
  reconcileVerdict,
  type AssertionResult,
  type CellEvidence,
  type CellReport,
  type ParsedCellReport,
  type StepBudget,
} from "@/lib/scenario-verdict";
import { createToolRunner } from "@/lib/drivers/tool-runner";
import type { CellLogin, TargetDriver } from "@/lib/drivers/types";
import { createDesktopDriver, preflightAgentWpf } from "@/lib/drivers/desktop-driver";
import { createWebDriver } from "@/lib/drivers/web-driver";
import { settleWithLimit } from "@/lib/concurrency";

const PERSONA_MODEL_PROVIDER = "anthropic";
const PERSONA_MODEL_ID = "claude-sonnet-4-5";
const PERSONA_MODEL_FALLBACK_ID = "claude-opus-5-5";
// Wall-clock budget per persona × scenario cell; afterwards browser tools refuse to run.
// Grows with the step budget, so scenarios with many allowed actions get enough time.
const CELL_TIMEOUT_MS = 10 * 60_000;
const CELL_TIMEOUT_PER_STEP_MS = 20_000;

function getCellTimeoutMs(maxSteps: number) {
  return Math.max(CELL_TIMEOUT_MS, maxSteps * CELL_TIMEOUT_PER_STEP_MS);
}
// Time the persona gets to write its report after the budget ran out, before the session is aborted.
const REPORT_GRACE_MS = 60_000;
// A session without any model output or tool activity for this long is considered hung.
const IDLE_TIMEOUT_MS = 3 * 60_000;
const activeRuns = globalThis.__honestProductTesterRuns ?? new Map<string, Promise<void>>();

globalThis.__honestProductTesterRuns = activeRuns;

declare global {
  var __honestProductTesterRuns: Map<string, Promise<void>> | undefined;
}

export function ensureRunStarted(runId: string) {
  if (activeRuns.has(runId)) {
    return;
  }

  const job = executeRun(runId).finally(() => {
    activeRuns.delete(runId);
  });

  activeRuns.set(runId, job);
}

async function executeRun(runId: string) {
  const { manifest } = await getRun(runId);
  const personas = await getPersonas();
  const scenarios = getRunScenarios(manifest);
  const runPersonas = manifest.personas
    .map((personaId) => personas.find((item) => item.id === personaId))
    .filter((persona): persona is Persona => Boolean(persona));

  const target = manifest.target;

  if (target.kind === "desktop") {
    try {
      await preflightAgentWpf();
    } catch (error) {
      await updateRunManifest(runId, (current) => ({
        ...current,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "agent-wpf is not available.",
      }));
      return;
    }
  }

  const maxParallel = manifest.maxParallel ?? Number.POSITIVE_INFINITY;
  // Real mouse/keyboard input moves the one shared cursor, so only a lone tester may use it.
  const realInput = maxParallel === 1;

  await updateRunManifest(runId, (current) => ({
    ...current,
    status: "running",
    startedAt: current.startedAt ?? new Date().toISOString(),
  }));

  // Personas run in parallel (up to maxParallel); each works through its scenarios in turn.
  const results = await settleWithLimit(runPersonas, maxParallel, (persona) =>
    runPersonaScenarios(runId, target, persona, scenarios, manifest.reportLanguage, realInput),
  );
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  await updateRunManifest(runId, (current) => ({
    ...current,
    status: failures.length > 0 ? "failed" : "completed",
    completedAt: new Date().toISOString(),
    currentPersonaId: undefined,
    error:
      failures.length > 0
        ? failures
            .map((failure) =>
              failure.reason instanceof Error
                ? failure.reason.message
                : "Unknown persona failure",
            )
            .join("\n")
        : undefined,
  }));
}

async function runPersonaScenarios(
  runId: string,
  target: RunTarget,
  persona: Persona,
  scenarios: Scenario[],
  reportLanguage: Locale | undefined,
  realInput: boolean,
) {
  const errors: string[] = [];

  for (const scenario of scenarios.filter((item) => isPersonaAssigned(item, persona.id))) {
    try {
      await runCell(runId, target, persona, scenario, reportLanguage, realInput);
    } catch (error) {
      errors.push(
        `${persona.name} / ${scenario.title}: ${error instanceof Error ? error.message : "unknown failure"}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

async function runCell(
  runId: string,
  target: RunTarget,
  persona: Persona,
  scenario: Scenario,
  reportLanguage: Locale | undefined,
  realInput: boolean,
) {
  const cellId = getCellId(persona.id, scenario.id);
  const isExplore = scenario.id === EXPLORE_SCENARIO_ID;
  const screenshotDir = getScreenshotDir(runId);
  const driver = createCellDriver(target, scenario, { cellId, runId, screenshotDir }, realInput);
  const reportTitle = isExplore ? persona.name : `${persona.name} – ${scenario.title}`;
  // Report files are written in the run's report language; runs without one stay English.
  const reportDictionary = getDictionary(reportLanguage ?? "en");

  await updateCellRecord(runId, cellId, (current) => ({
    ...current,
    status: "running",
    startedAt: current.startedAt ?? new Date().toISOString(),
    summary: { key: "launching" },
  }));
  await appendCellObservation(runId, cellId, { key: "runStarted" });

  let login: CellLogin;

  try {
    login = await driver.resolvePersona(persona, scenario);
  } catch (error) {
    // E.g. a broken credentials file; fail the cell instead of leaving it "running".
    await failCell(runId, cellId, { isExplore, scenario, reportTitle, reportDictionary }, 0, error);
    throw error;
  }

  if (login.skipReason) {
    await skipCell(runId, cellId, scenario, reportTitle, login.skipReason, reportDictionary);
    return;
  }

  if (login.notice) {
    await appendCellObservation(runId, cellId, login.notice);
  }

  const budget = createStepBudget(scenario.maxSteps);
  const control = {
    timedOut: false,
    idle: false,
    abortedByLimit: false,
    abort: () => {},
  };
  // Text of the latest assistant message only; earlier commentary must not end up in the report.
  let lastMessageText = "";
  let providerError: string | undefined;

  const tools = driver.createTools(
    createToolRunner({ budget, cellId, control, exec: driver.exec, runId }),
  );
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const personaModel = resolvePersonaModel(modelRegistry);

  const { session } = await createAgentSession({
    authStorage,
    customTools: tools,
    model: personaModel,
    modelRegistry,
    tools: [],
    thinkingLevel: "low",
    sessionManager: SessionManager.inMemory(),
  });

  control.abort = () => {
    control.abortedByLimit = true;
    void session.abort();
  };

  // Started right before the first prompt, so a slow login does not count as idle time.
  let watchdog: ReturnType<typeof createIdleWatchdog> | undefined;

  const unsubscribe = session.subscribe((event) => {
    watchdog?.touch();
    void handleSessionEvent(runId, cellId, event);
    const eventProviderError = getProviderError(event);

    if (eventProviderError) {
      providerError = eventProviderError;
    }

    if (
      event.type === "message_start" &&
      "role" in event.message &&
      event.message.role === "assistant"
    ) {
      lastMessageText = "";
    }

    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      lastMessageText += event.assistantMessageEvent.delta;
    }
  });

  const readReport = async <T>(parse: (text: string) => T) => {
    const outcome = await parseWithRepair(lastMessageText, parse, async (errorMessage) => {
      if (control.abortedByLimit) {
        throw new Error("Session was stopped; no repair attempt.");
      }

      await session.prompt(buildRepairPrompt(errorMessage));
      return lastMessageText;
    });

    await writeCellRawOutput(runId, cellId, outcome.attempts).catch(() => undefined);

    return outcome;
  };

  let graceTimer: NodeJS.Timeout | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;

  try {
    await driver.start();

    if (login.username) {
      const { username } = login;

      await updateCellRecord(runId, cellId, (current) => ({
        ...current,
        summary: { key: "loggingIn", params: { username } },
      }));
      await driver.login();
      await appendCellObservation(runId, cellId, { key: "loggedIn", params: { username } });
    }

    // Started after launch and login, so a slow app start does not eat the persona's time.
    timeoutTimer = setTimeout(() => {
      control.timedOut = true;
      graceTimer = setTimeout(control.abort, REPORT_GRACE_MS);
    }, getCellTimeoutMs(scenario.maxSteps));

    watchdog = createIdleWatchdog({
      idleMs: IDLE_TIMEOUT_MS,
      onIdle: () => {
        control.idle = true;
        control.abort();
        void appendCellObservation(runId, cellId, idleMessage());
      },
    });

    await session.prompt(
      isExplore
        ? driver.buildExplorePrompt(persona, Boolean(login.username), reportLanguage)
        : driver.buildMissionPrompt(persona, scenario, Boolean(login.username), reportLanguage),
    );

    if (providerError && !control.abortedByLimit) {
      throw new Error(providerError);
    }

    if (isExplore) {
      const outcome = await readReport(parseStructuredSummary);

      if (!outcome.ok) {
        throw control.idle
          ? new Error(renderLiveText(idleMessage(), en))
          : unreadableReportError(outcome.error, cellId);
      }

      const structuredSummary = outcome.value;
      const finalReport = buildSummaryMarkdown(reportDictionary, persona.name, structuredSummary);

      await updateCellRecord(runId, cellId, (current) => ({
        ...current,
        status: "completed",
        completedAt: new Date().toISOString(),
        summary: { key: "exploreFinished" },
        structuredSummary,
        finalReport,
      }));
      await writeCellReport(runId, cellId, finalReport);
    } else {
      const cellReport = await evaluateMission({
        budget,
        cellId,
        control,
        driver,
        report: await readReport(parseCellReport),
        scenario,
      });
      const finalReport = buildCellReportMarkdown(
        reportDictionary,
        reportTitle,
        scenario.successCriteria,
        cellReport,
      );

      await updateCellRecord(runId, cellId, (current) => ({
        ...current,
        status: "completed",
        completedAt: new Date().toISOString(),
        summary: { key: "scenarioFinished", params: { verdict: cellReport.verdict } },
        cellReport,
        finalReport,
      }));
      await writeCellReport(runId, cellId, finalReport);
    }

    await appendCellObservation(runId, cellId, { key: "reportWritten" });
  } catch (error) {
    await failCell(
      runId,
      cellId,
      { isExplore, scenario, reportTitle, reportDictionary },
      budget.used,
      error,
    );

    throw error;
  } finally {
    watchdog?.stop();
    clearTimeout(timeoutTimer);
    clearTimeout(graceTimer);
    unsubscribe();
    session.dispose();
    await driver.close().catch(() => undefined);
  }
}

async function failCell(
  runId: string,
  cellId: string,
  {
    isExplore,
    scenario,
    reportTitle,
    reportDictionary,
  }: { isExplore: boolean; scenario: Scenario; reportTitle: string; reportDictionary: Dictionary },
  stepsUsed: number,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "Unknown persona failure";

  await updateCellRecord(runId, cellId, (current) => ({
    ...current,
    status: "failed",
    completedAt: new Date().toISOString(),
    summary: { key: "runFailed" },
    error: message,
    cellReport: isExplore ? undefined : buildFixedReport("error", scenario, stepsUsed, message),
  }));
  await writeCellReport(
    runId,
    cellId,
    buildFailedReportMarkdown(reportDictionary, reportTitle, message),
  );
}

async function skipCell(
  runId: string,
  cellId: string,
  scenario: Scenario,
  reportTitle: string,
  reason: LiveMessage,
  reportDictionary: Dictionary,
) {
  const cellReport = {
    ...buildFixedReport("skipped", scenario, 0, renderLiveText(reason, en)),
    noteMessage: reason,
  };

  await updateCellRecord(runId, cellId, (current) => ({
    ...current,
    status: "skipped",
    completedAt: new Date().toISOString(),
    summary: reason,
    cellReport,
  }));
  await appendCellObservation(runId, cellId, reason);
  await writeCellReport(
    runId,
    cellId,
    buildCellReportMarkdown(reportDictionary, reportTitle, scenario.successCriteria, cellReport),
  );
}

function buildFixedReport(
  verdict: "error" | "skipped",
  scenario: Scenario,
  stepsUsed: number,
  note: string,
): CellReport {
  return {
    verdict,
    misjudged: false,
    evidence: {},
    stepsUsed,
    maxSteps: scenario.maxSteps,
    frictionPoints: [],
    quote: "",
    assertionResults: [],
    note,
  };
}

async function evaluateMission({
  budget,
  cellId,
  control,
  driver,
  report,
  scenario,
}: {
  budget: StepBudget;
  cellId: string;
  control: { timedOut: boolean; idle: boolean; abortedByLimit: boolean };
  driver: TargetDriver;
  report: ParseOutcome<ParsedCellReport>;
  scenario: Scenario;
}): Promise<CellReport> {
  const limitHit = budget.exhausted || control.timedOut || control.abortedByLimit;
  let parsed: ParsedCellReport | undefined = report.ok ? report.value : undefined;

  if (!report.ok && limitHit) {
    // The persona ran out of budget before it could write a report.
    parsed = { selfVerdict: "limit_reached", evidence: {}, frictionPoints: [], quote: "" };
  }

  // Without a readable report only the assertions can still judge the outcome.
  if (
    !report.ok &&
    !parsed &&
    !scenario.assertions.some((assertion) => assertionAppliesTo(assertion.type, driver.kind))
  ) {
    throw unreadableReportError(report.error, cellId);
  }

  const finalEvidence: CellEvidence = await driver.readFinalEvidence().catch(() => ({}));
  const assertionResults = await checkApplicableAssertions(
    driver,
    scenario.assertions,
    finalEvidence,
  );
  const { verdict, misjudged } = parsed
    ? reconcileVerdict(parsed.selfVerdict, assertionResults)
    : {
        verdict: assertionResults.every((result) => result.passed || result.notApplicable)
          ? ("passed" as const)
          : ("failed" as const),
        misjudged: false,
      };

  await driver.captureFinal().catch(() => undefined);

  return {
    verdict,
    selfVerdict: parsed?.selfVerdict,
    misjudged,
    // The persona's own evidence wins; the driver fills in what it left out.
    evidence: { ...finalEvidence, ...parsed?.evidence },
    stepsUsed: budget.used,
    maxSteps: scenario.maxSteps,
    frictionPoints: parsed?.frictionPoints ?? [],
    quote: parsed?.quote ?? "",
    assertionResults,
    ...(parsed
      ? budgetNote(control, budget.exhausted, scenario.maxSteps)
      : liveNote({ key: "reportUnreadable" })),
  };
}

/** Checks the assertions that fit the driver's target; the others are only listed. */
async function checkApplicableAssertions(
  driver: TargetDriver,
  assertions: ScenarioAssertion[],
  finalEvidence: CellEvidence,
): Promise<AssertionResult[]> {
  const applicable = assertions.filter((assertion) =>
    assertionAppliesTo(assertion.type, driver.kind),
  );
  const checked = await driver.checkAssertions(applicable, finalEvidence);

  return assertions.map(
    (assertion) =>
      checked[applicable.indexOf(assertion)] ?? { ...assertion, passed: false, notApplicable: true },
  );
}

function createCellDriver(
  target: RunTarget,
  scenario: Scenario,
  cell: { cellId: string; runId: string; screenshotDir: string },
  realInput: boolean,
) {
  return target.kind === "desktop"
    ? createDesktopDriver({ ...cell, realInput, target })
    : createWebDriver({ ...cell, startUrl: resolveStartUrl(target.url, scenario.startPath) });
}

function unreadableReportError(error: Error, cellId: string) {
  return new Error(
    `Persona report was not valid JSON, even after one repair attempt: ${error.message} (raw output: cells/${cellId}.raw.txt)`,
  );
}

function liveNote(noteMessage: LiveMessage) {
  return { note: renderLiveText(noteMessage, en), noteMessage };
}

function idleMessage(): LiveMessage {
  return { key: "idleStopped", params: { minutes: IDLE_TIMEOUT_MS / 60_000 } };
}

function budgetNote(
  control: { timedOut: boolean; idle: boolean },
  stepsExhausted: boolean,
  maxSteps: number,
) {
  const noteMessage: LiveMessage | undefined = control.idle
    ? idleMessage()
    : control.timedOut
    ? { key: "timeBudgetUsed", params: { minutes: Math.round(getCellTimeoutMs(maxSteps) / 60_000) } }
    : stepsExhausted
      ? { key: "stepBudgetUsed", params: { steps: maxSteps } }
      : undefined;

  return noteMessage ? liveNote(noteMessage) : {};
}

async function handleSessionEvent(
  runId: string,
  cellId: string,
  event: AgentSessionEvent,
) {
  if (event.type === "tool_execution_start") {
    await updateCellRecord(runId, cellId, (current) => ({
      ...current,
      summary: { key: "toolRunning", params: { tool: event.toolName } },
    }));
  }

  if (event.type === "tool_execution_end") {
    await updateCellRecord(runId, cellId, (current) => ({
      ...current,
      summary: {
        key: event.isError ? "toolFailed" : "toolCompleted",
        params: { tool: event.toolName },
      },
    }));
  }
}

function parseStructuredSummary(rawText: string): PersonaReportInsight[] {
  const candidate = rawText.trim();

  if (!candidate) {
    throw new Error("Persona returned no structured summary.");
  }

  const jsonText = extractJsonObject(candidate);
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;

  return REPORT_INSIGHT_DEFINITIONS.map(({ id }) => {
    const answer = parsed[id];

    if (typeof answer !== "string" || !answer.trim()) {
      throw new Error(`Persona summary is missing "${id}".`);
    }

    return {
      id,
      answer: answer.trim(),
    };
  });
}

function resolvePersonaModel(modelRegistry: ModelRegistry) {
  const configuredModel = modelRegistry.find(PERSONA_MODEL_PROVIDER, PERSONA_MODEL_ID);

  if (configuredModel) {
    return configuredModel;
  }

  const fallbackModel = modelRegistry.find(
    PERSONA_MODEL_PROVIDER,
    PERSONA_MODEL_FALLBACK_ID,
  );

  if (!fallbackModel) {
    throw new Error(
      `Pi model ${PERSONA_MODEL_PROVIDER}/${PERSONA_MODEL_ID} is not available, and fallback ${PERSONA_MODEL_FALLBACK_ID} was not found.`,
    );
  }

  return fallbackModel;
}

function getProviderError(event: AgentSessionEvent) {
  if (event.type !== "turn_end") {
    return undefined;
  }

  const message = event.message;

  if ("errorMessage" in message && typeof message.errorMessage === "string") {
    return message.errorMessage;
  }

  return undefined;
}

function extractJsonObject(rawText: string) {
  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error("Persona output was not valid JSON.");
  }

  return rawText.slice(firstBrace, lastBrace + 1);
}
