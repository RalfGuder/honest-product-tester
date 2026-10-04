import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Type } from "@sinclair/typebox";
import sharp from "sharp";
import {
  AuthStorage,
  createAgentSession,
  defineTool,
  ModelRegistry,
  SessionManager,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";

import { getPersonaLogin, type BasicAuth, type PersonaLogin } from "@/lib/credentials";
import type { Locale } from "@/i18n/config";
import { renderLiveText, type LiveMessage } from "@/i18n/live";
import { en, type Dictionary } from "@/i18n/dictionaries/en";
import { getPersonas, type Persona } from "@/lib/personas";
import { getDictionary } from "@/i18n/dictionaries";
import { reportLanguageInstruction } from "@/lib/report-language";
import {
  buildCellReportMarkdown,
  buildFailedReportMarkdown,
  buildSummaryMarkdown,
} from "@/lib/report-markdown";
import {
  appendCellAction,
  appendCellObservation,
  getCellId,
  getRun,
  getRunScenarios,
  getScreenshotDir,
  updateCellRecord,
  updateRunManifest,
  writeCellRawOutput,
  writeCellReport,
} from "@/lib/runs";
import { buildScrollScript, describeScroll, type ScrollResult } from "@/lib/browser-scroll";
import { buildInspectScript, describeInspect, type InspectResult } from "@/lib/browser-inspect";
import { buildFocusScript, toCropRegion, type FocusResult } from "@/lib/browser-zoom";
import { createIdleWatchdog } from "@/lib/idle-watchdog";
import {
  buildRepairPrompt,
  JSON_STRING_RULE,
  parseWithRepair,
  type ParseOutcome,
} from "@/lib/report-parsing";
import {
  REPORT_INSIGHT_DEFINITIONS,
  type PersonaReportInsight,
} from "@/lib/report-insights";
import {
  EXPLORE_SCENARIO_ID,
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
  type CellReport,
  type ParsedCellReport,
  type StepBudget,
} from "@/lib/scenario-verdict";

// On Windows the .bin shim is a shell script that execFile cannot spawn,
// so call the bundled native binary directly.
const AGENT_BROWSER_BIN =
  process.platform === "win32"
    ? path.join(
        process.cwd(),
        "node_modules",
        "agent-browser",
        "bin",
        "agent-browser-win32-x64.exe",
      )
    : path.join(process.cwd(), "node_modules", ".bin", "agent-browser");
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
// browser_zoom enlarges the area around a text so tiny details (status dots, icons) survive
// the downscaling the model applies to images.
const ZOOM_FACTOR = 3;
const ZOOM_DEFAULT_MARGIN = 120;
// A session without any model output or tool activity for this long is considered hung.
const IDLE_TIMEOUT_MS = 3 * 60_000;
// Refused actions tolerated after the budget ran out, before the session is aborted.
const MAX_BLOCKED_ACTIONS = 3;
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

  await updateRunManifest(runId, (current) => ({
    ...current,
    status: "running",
    startedAt: current.startedAt ?? new Date().toISOString(),
  }));

  // Personas run in parallel; each persona works through its scenarios one after another.
  const results = await Promise.allSettled(
    runPersonas.map((persona) =>
      runPersonaScenarios(runId, manifest.url, persona, scenarios, manifest.reportLanguage),
    ),
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
  url: string,
  persona: Persona,
  scenarios: Scenario[],
  reportLanguage: Locale | undefined,
) {
  const errors: string[] = [];

  for (const scenario of scenarios.filter((item) => isPersonaAssigned(item, persona.id))) {
    try {
      await runCell(runId, url, persona, scenario, reportLanguage);
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
  url: string,
  persona: Persona,
  scenario: Scenario,
  reportLanguage: Locale | undefined,
) {
  const cellId = getCellId(persona.id, scenario.id);
  const browserSession = getBrowserSessionName(runId, cellId);
  const isExplore = scenario.id === EXPLORE_SCENARIO_ID;
  const startUrl = resolveStartUrl(url, scenario.startPath);
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

  const login = await resolveCellLogin(persona, scenario, startUrl);

  if (login.skipReason) {
    await skipCell(runId, cellId, scenario, reportTitle, login.skipReason, reportDictionary);
    return;
  }

  if (login.notice) {
    await appendCellObservation(runId, cellId, login.notice);
  }

  const screenshotDir = getScreenshotDir(runId);
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

  const tools = createBrowserTools({
    browserSession,
    budget,
    cellId,
    control,
    runId,
    screenshotDir,
  });
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
  const timeoutTimer = setTimeout(() => {
    control.timedOut = true;
    graceTimer = setTimeout(control.abort, REPORT_GRACE_MS);
  }, getCellTimeoutMs(scenario.maxSteps));

  try {
    if (login.value) {
      await updateCellRecord(runId, cellId, (current) => ({
        ...current,
        summary: { key: "loggingIn", params: { username: login.value?.username ?? "" } },
      }));
      await loginPersona(browserSession, login.value);
      await appendCellObservation(runId, cellId, {
        key: "loggedIn",
        params: { username: login.value.username },
      });
    }

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
        ? buildPersonaPrompt(persona, startUrl, Boolean(login.value), reportLanguage)
        : buildMissionPrompt(persona, scenario, startUrl, Boolean(login.value), reportLanguage),
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
        browserSession,
        budget,
        cellId,
        control,
        report: await readReport(parseCellReport),
        runId,
        scenario,
        screenshotDir,
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
    const message = error instanceof Error ? error.message : "Unknown persona failure";

    await updateCellRecord(runId, cellId, (current) => ({
      ...current,
      status: "failed",
      completedAt: new Date().toISOString(),
      summary: { key: "runFailed" },
      error: message,
      cellReport: isExplore
        ? undefined
        : buildFixedReport("error", scenario, budget.used, message),
    }));
    await writeCellReport(
      runId,
      cellId,
      buildFailedReportMarkdown(reportDictionary, reportTitle, message),
    );

    throw error;
  } finally {
    watchdog?.stop();
    clearTimeout(timeoutTimer);
    clearTimeout(graceTimer);
    unsubscribe();
    session.dispose();
    await closeBrowserSession(browserSession).catch(() => undefined);
  }
}

async function resolveCellLogin(
  persona: Persona,
  scenario: Scenario,
  startUrl: string,
): Promise<{ value?: PersonaLogin; skipReason?: LiveMessage; notice?: LiveMessage }> {
  if (scenario.login === "anonymous") {
    return {};
  }

  const hostMismatch = (loginHosts: string[]): LiveMessage => ({
    key: scenario.login === "auto" ? "loginSkippedOtherHost" : "loginRequiredWrongHost",
    params: { loginHost: loginHosts.join(", "), targetHost: new URL(startUrl).hostname },
  });

  if (scenario.login === "auto") {
    const result = await getPersonaLogin(persona.id, startUrl);

    // Credentials only exist for other sites; never log in there when testing this one.
    if (result.kind === "otherHost") {
      return { notice: hostMismatch(result.loginHosts) };
    }

    return result.kind === "login" ? { value: result.login } : {};
  }

  try {
    const result = await getPersonaLogin(persona.id, startUrl);

    if (result.kind === "none") {
      return { skipReason: { key: "loginRequiredNoFile" } };
    }

    return result.kind === "login"
      ? { value: result.login }
      : { skipReason: hostMismatch(result.loginHosts) };
  } catch (error) {
    return {
      skipReason: {
        key: "loginRequiredError",
        params: { error: error instanceof Error ? error.message : "no credentials" },
      },
    };
  }
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
  browserSession,
  budget,
  cellId,
  control,
  report,
  runId,
  scenario,
  screenshotDir,
}: {
  browserSession: string;
  budget: StepBudget;
  cellId: string;
  control: { timedOut: boolean; idle: boolean; abortedByLimit: boolean };
  report: ParseOutcome<ParsedCellReport>;
  runId: string;
  scenario: Scenario;
  screenshotDir: string;
}): Promise<CellReport> {
  const limitHit = budget.exhausted || control.timedOut || control.abortedByLimit;
  let parsed: ParsedCellReport | undefined = report.ok ? report.value : undefined;

  if (!report.ok && limitHit) {
    // The persona ran out of budget before it could write a report.
    parsed = { selfVerdict: "limit_reached", evidence: {}, frictionPoints: [], quote: "" };
  }

  // Without a readable report only the assertions can still judge the outcome.
  if (!report.ok && !parsed && scenario.assertions.length === 0) {
    throw unreadableReportError(report.error, cellId);
  }

  const finalUrl = await readCurrentUrl(browserSession).catch(() => undefined);
  const assertionResults = await checkAssertions(browserSession, scenario.assertions, finalUrl);
  const { verdict, misjudged } = parsed
    ? reconcileVerdict(parsed.selfVerdict, assertionResults)
    : {
        verdict: assertionResults.every((result) => result.passed)
          ? ("passed" as const)
          : ("failed" as const),
        misjudged: false,
      };

  await captureFinalScreenshot(runId, cellId, browserSession, screenshotDir).catch(
    () => undefined,
  );

  return {
    verdict,
    selfVerdict: parsed?.selfVerdict,
    misjudged,
    evidence: { ...parsed?.evidence, finalUrl: parsed?.evidence.finalUrl ?? finalUrl },
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

async function readCurrentUrl(browserSession: string) {
  const { stdout } = await runAgentBrowser(["--session", browserSession, "get", "url"]);

  return stdout.trim();
}

async function checkAssertions(
  browserSession: string,
  assertions: ScenarioAssertion[],
  finalUrl: string | undefined,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];

  for (const assertion of assertions) {
    if (assertion.type === "url_contains") {
      results.push({
        ...assertion,
        passed: Boolean(finalUrl?.includes(assertion.value)),
        detail: finalUrl,
      });
      continue;
    }

    try {
      const script = `document.body.innerText.includes(${JSON.stringify(assertion.value)})`;
      const { stdout } = await runAgentBrowser(["--session", browserSession, "eval", script]);

      results.push({ ...assertion, passed: stdout.trim() === "true" });
    } catch (error) {
      results.push({
        ...assertion,
        passed: false,
        detail: error instanceof Error ? error.message : "Check failed.",
      });
    }
  }

  return results;
}

async function captureFinalScreenshot(
  runId: string,
  cellId: string,
  browserSession: string,
  screenshotDir: string,
) {
  const fileName = `${cellId}-${Date.now()}-final.png`;

  await runAgentBrowser([
    "--session",
    browserSession,
    "screenshot",
    path.join(screenshotDir, fileName),
  ]);
  await updateCellRecord(runId, cellId, (current) => ({
    ...current,
    latestScreenshotFileName: fileName,
    latestScreenshotTakenAt: new Date().toISOString(),
  }));
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

const TIME_UP_MESSAGE =
  "Time is up. Do not call any more tools. Return your final JSON report now.";
const STEP_LIMIT_MESSAGE =
  "Step budget exhausted. Do not call any more browser actions. Return your final JSON report now.";

function createBrowserTools({
  browserSession,
  budget,
  cellId,
  control,
  runId,
  screenshotDir,
}: {
  browserSession: string;
  budget: StepBudget;
  cellId: string;
  control: { timedOut: boolean; abort: () => void };
  runId: string;
  screenshotDir: string;
}) {
  // Actions change the page and count against the step budget; reads are free.
  const runTool = async (
    name: string,
    args: string[],
    { isAction = false, display }: { isAction?: boolean; display?: string } = {},
  ) => {
    // `display` replaces long generated arguments (e.g. scripts) in the action log.
    const input = display ?? args.join(" ");

    if (control.timedOut) {
      throw new Error(TIME_UP_MESSAGE);
    }

    if (isAction && !budget.tryConsume()) {
      if (budget.blocked > MAX_BLOCKED_ACTIONS) {
        control.abort();
      }

      await appendCellObservation(runId, cellId, {
        key: "stepBudgetRefused",
        params: { tool: name },
      });
      throw new Error(STEP_LIMIT_MESSAGE);
    }

    try {
      const result = await runAgentBrowser(["--session", browserSession, ...args]);
      const stdout = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

      await appendCellAction(runId, cellId, {
        at: new Date().toISOString(),
        tool: name,
        input,
        outcome: "success",
      });

      if (stdout) {
        await appendCellObservation(runId, cellId, `${name}: ${stdout.slice(0, 280)}`);
      }

      return stdout || "ok";
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `${name} failed unexpectedly`;

      await appendCellAction(runId, cellId, {
        at: new Date().toISOString(),
        tool: name,
        input,
        outcome: "error",
      });
      await appendCellObservation(runId, cellId, {
        key: "toolError",
        params: { tool: name, error: message },
      });

      throw error;
    }
  };
  const action = { isAction: true };

  return [
    defineTool({
      name: "browser_open",
      label: "Browser Open",
      description: "Open a URL in agent-browser.",
      parameters: Type.Object({
        url: Type.String({ description: "Absolute URL to open" }),
      }),
      execute: async (_toolCallId, params) => ({
        content: [
          { type: "text", text: await runTool("browser_open", ["open", params.url], action) },
        ],
        details: {},
      }),
    }),
    defineTool({
      name: "browser_snapshot",
      label: "Browser Snapshot",
      description: "Get the current accessibility tree snapshot with refs.",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [{ type: "text", text: await runTool("browser_snapshot", ["snapshot"]) }],
        details: {},
      }),
    }),
    defineTool({
      name: "browser_click",
      label: "Browser Click",
      description: "Click an element by ref or selector.",
      parameters: Type.Object({
        target: Type.String({ description: "Ref like @e2 or selector" }),
      }),
      execute: async (_toolCallId, params) => ({
        content: [
          {
            type: "text",
            text: await runTool("browser_click", ["click", params.target], action),
          },
        ],
        details: {},
      }),
    }),
    defineTool({
      name: "browser_type",
      label: "Browser Type",
      description: "Type into a field using a ref or selector.",
      parameters: Type.Object({
        target: Type.String({ description: "Ref like @e2 or selector" }),
        text: Type.String({ description: "Text to type" }),
      }),
      execute: async (_toolCallId, params) => ({
        content: [
          {
            type: "text",
            text: await runTool("browser_type", ["type", params.target, params.text], action),
          },
        ],
        details: {},
      }),
    }),
    defineTool({
      name: "browser_press",
      label: "Browser Press",
      description: "Press a keyboard key such as Enter or Tab.",
      parameters: Type.Object({
        key: Type.String({ description: "Keyboard key" }),
      }),
      execute: async (_toolCallId, params) => ({
        content: [
          { type: "text", text: await runTool("browser_press", ["press", params.key], action) },
        ],
        details: {},
      }),
    }),
    defineTool({
      name: "browser_scroll",
      label: "Browser Scroll",
      description:
        "Scroll up or down. Scrolls the page; if the page cannot move, it scrolls the largest visible scrollable area instead (e.g. a dialog or list). The result says what moved and whether its end is reached.",
      parameters: Type.Object({
        direction: Type.Union([Type.Literal("up"), Type.Literal("down")]),
        pixels: Type.Optional(Type.Number({ description: "Number of pixels to scroll" })),
        withinText: Type.Optional(
          Type.String({
            description:
              "Text currently visible inside the list or panel you want to scroll, e.g. a name in a member list. Scrolls that area instead of the page.",
          }),
        ),
      }),
      execute: async (_toolCallId, params) => {
        const pixels = Math.abs(params.pixels ?? 700) * (params.direction === "up" ? -1 : 1);
        const output = await runTool(
          "browser_scroll",
          ["eval", buildScrollScript(pixels, params.withinText)],
          {
            ...action,
            display: `${params.direction} ${Math.abs(pixels)}${params.withinText ? ` within "${params.withinText}"` : ""}`,
          },
        );

        return {
          content: [{ type: "text", text: describeScroll(parseEvalJson(output), params.direction) }],
          details: {},
        };
      },
    }),
    defineTool({
      name: "browser_wait",
      label: "Browser Wait",
      description: "Wait for a number of milliseconds.",
      parameters: Type.Object({
        ms: Type.Number({ description: "Milliseconds to wait" }),
      }),
      execute: async (_toolCallId, params) => ({
        content: [
          { type: "text", text: await runTool("browser_wait", ["wait", `${params.ms}`], action) },
        ],
        details: {},
      }),
    }),
    defineTool({
      name: "browser_screenshot",
      label: "Browser Screenshot",
      description:
        "Capture a screenshot of the visible page. You receive the image, so use it whenever visual details matter (colors, icons, status dots, layout).",
      parameters: Type.Object({
        label: Type.String({ description: "Short screenshot label" }),
      }),
      execute: async (_toolCallId, params) => {
        const safeLabel = params.label.replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
        const fileName = `${cellId}-${Date.now()}-${safeLabel}.png`;
        const screenshotPath = path.join(screenshotDir, fileName);
        const output = await runTool("browser_screenshot", [
          "screenshot",
          screenshotPath,
        ]);
        const screenshotTakenAt = new Date().toISOString();

        await updateCellRecord(runId, cellId, (current) => ({
          ...current,
          latestScreenshotFileName: fileName,
          latestScreenshotTakenAt: screenshotTakenAt,
          summary: { key: "screenshotCaptured", params: { label: params.label } },
        }));

        // Hand the image to the model too, so the persona can judge what the snapshot cannot
        // express (colors, icons, status indicators).
        const image = await readFile(screenshotPath).catch(() => undefined);

        return {
          content: [
            { type: "text", text: `${output}\nSaved to ${screenshotPath}` },
            ...(image
              ? [{ type: "image" as const, data: image.toString("base64"), mimeType: "image/png" }]
              : []),
          ],
          details: {},
        };
      },
    }),
    defineTool({
      name: "browser_zoom",
      label: "Browser Zoom",
      description: `Look closely at a small part of the visible page: finds the given visible text (e.g. a person's name) and returns an image of the area around it, enlarged ${ZOOM_FACTOR}x. Use it for tiny details next to that text, such as status dots on profile pictures or small icons.`,
      parameters: Type.Object({
        text: Type.String({ description: "Visible text to zoom in on, e.g. \"Person 14\"" }),
        margin: Type.Optional(
          Type.Number({
            description: `Pixels of surrounding area to include on each side (default ${ZOOM_DEFAULT_MARGIN}).`,
          }),
        ),
      }),
      execute: async (_toolCallId, params) => {
        const output = await runTool("browser_zoom", ["eval", buildFocusScript(params.text)], {
          display: `"${params.text}"`,
        });
        const focus = parseEvalJson<FocusResult>(output);
        const region =
          focus.found && focus.rect && focus.viewport
            ? toCropRegion(
                focus.rect,
                Math.max(20, params.margin ?? ZOOM_DEFAULT_MARGIN),
                focus.viewport,
                focus.devicePixelRatio ?? 1,
              )
            : undefined;

        if (!region) {
          return {
            content: [
              {
                type: "text",
                text: `"${params.text}" is not visible on the screen right now. Scroll it into view first.`,
              },
            ],
            details: {},
          };
        }

        const fileName = `${cellId}-${Date.now()}-zoom.png`;
        const screenshotPath = path.join(screenshotDir, fileName);

        await runTool("browser_zoom", ["screenshot", screenshotPath], {
          display: `screenshot for "${params.text}"`,
        });

        const zoomed = await sharp(screenshotPath)
          .extract(region)
          .resize({ width: region.width * ZOOM_FACTOR, kernel: "nearest" })
          .png()
          .toBuffer();

        await sharp(zoomed).toFile(screenshotPath);
        await updateCellRecord(runId, cellId, (current) => ({
          ...current,
          latestScreenshotFileName: fileName,
          latestScreenshotTakenAt: new Date().toISOString(),
          summary: { key: "screenshotCaptured", params: { label: `zoom: ${params.text}` } },
        }));

        return {
          content: [
            { type: "text", text: `Area around "${params.text}", enlarged ${ZOOM_FACTOR}x.` },
            { type: "image", data: zoomed.toString("base64"), mimeType: "image/png" },
          ],
          details: {},
        };
      },
    }),
    defineTool({
      name: "browser_inspect",
      label: "Browser Inspect",
      description:
        "Read the HTML markup around a visible text (e.g. a person's name), reduced to tags, classes and descriptive attributes. Reveals state that the snapshot does not show, such as status indicators inside avatars (look for class names like 'presence', 'online', 'away', 'active').",
      parameters: Type.Object({
        text: Type.String({ description: "Visible text to inspect, e.g. \"Person 14\"" }),
      }),
      execute: async (_toolCallId, params) => {
        const output = await runTool("browser_inspect", ["eval", buildInspectScript(params.text)], {
          display: `"${params.text}"`,
        });

        return {
          content: [
            {
              type: "text",
              text: describeInspect(params.text, parseEvalJson<InspectResult>(output)),
            },
          ],
          details: {},
        };
      },
    }),
    defineTool({
      name: "browser_get_title",
      label: "Browser Get Title",
      description: "Read the current page title.",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [{ type: "text", text: await runTool("browser_get_title", ["get", "title"]) }],
        details: {},
      }),
    }),
    defineTool({
      name: "browser_get_url",
      label: "Browser Get URL",
      description: "Read the current page URL.",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [{ type: "text", text: await runTool("browser_get_url", ["get", "url"]) }],
        details: {},
      }),
    }),
  ];
}

const LOGGED_IN_NOTE =
  "\nYou are already logged in with your own test account. Do not log out or change account settings.\n";

function buildPersonaPrompt(
  persona: Persona,
  url: string,
  loggedIn: boolean,
  reportLanguage: Locale | undefined,
) {
  const outputSchema = REPORT_INSIGHT_DEFINITIONS.map(
    ({ id, question }) => `  "${id}": "${question}"`,
  ).join("\n");

  return `
${persona.prompt}

You are testing this ${loggedIn ? "" : "public "}website live: ${url}
${loggedIn ? LOGGED_IN_NOTE : ""}
Use the browser tools to inspect the product in the way this persona naturally would. Do not follow a generic script. Let your priorities, interests, impatience, and curiosity determine what to do next.

Constraints:
- You may use only the browser tools.
- Keep the run concise. Aim for 6 to 10 browser actions total.
- You have the same fixed time budget as every other persona.
- No destructive actions, purchases, or final form submissions.
- Use browser_snapshot whenever you need to decide what to click next.
- Lists, dialogs and sidebars often scroll on their own and show only part of their content. When you need to see all entries, keep scrolling (use withinText for a specific list) until browser_scroll reports that the end is reached.
- Use browser_screenshot when something is notably good, bad, or confusing, or when you need to see visual details such as colors, icons, or status dots. You receive the screenshot as an image.
- Small details (status dots, tiny icons) are easy to miss on a full screenshot. Use browser_zoom with a visible text next to them, e.g. a person's name, to look closely, or browser_inspect to read the markup around that text.
- If a page is slow or broken, mention that in the relevant answer.

When you are done, return only valid JSON in this exact shape:

{
${outputSchema}
}

Rules for the answers:
- Each value must be a short answer in this persona's voice.
- Aim for roughly 8 to 10 words per answer.
- Do not repeat the question inside the answer.
- Be concrete about what you clicked, what happened, and what this persona wanted but did not get.
- Do not include markdown, commentary, code fences, or extra keys.
${JSON_STRING_RULE}
${reportLanguageInstruction(reportLanguage)}
`.trim();
}

const SUBMIT_ALLOWED_RULE =
  "- You may submit forms when the mission needs it (for example saving, sending a message). Never make purchases or payments, delete data, change passwords, email addresses or account settings, or log out.";
const SUBMIT_FORBIDDEN_RULE =
  "- Do not submit forms, make purchases, delete data, or change account settings. If the mission ends with a final submit, fill everything in, stop right before submitting, and count that as reaching the goal. Say so in evidence.quote.";

function buildMissionPrompt(
  persona: Persona,
  scenario: Scenario,
  url: string,
  loggedIn: boolean,
  reportLanguage: Locale | undefined,
) {
  return `
${persona.prompt}

You are testing this ${loggedIn ? "" : "public "}website live, starting at: ${url}
${loggedIn ? LOGGED_IN_NOTE : ""}
Your mission:
${scenario.mission}

You succeed when: ${scenario.successCriteria}

Work towards the mission the way this persona naturally would. Do not act like a test script: take the paths this persona would take, and react to the product with this persona's experience level and patience (${persona.patience}).
If this persona would realistically give up out of frustration or confusion, stop and report "gave_up". Giving up is a valid and valuable result.

Constraints:
- You may use only the browser tools.
- Hard budget: ${scenario.maxSteps} browser actions (open, click, type, press, scroll, wait). Snapshots, screenshots, title and URL reads are free. When the budget is used up, actions fail; then stop and report.
- There is also a fixed time budget. When time is up, tools fail; then stop and report.
${scenario.allowSubmit ? SUBMIT_ALLOWED_RULE : SUBMIT_FORBIDDEN_RULE}
- Use browser_snapshot whenever you need to decide what to click next.
- Lists, dialogs and sidebars often scroll on their own and show only part of their content. When you need to see all entries, keep scrolling (use withinText for a specific list) until browser_scroll reports that the end is reached.
- Use browser_screenshot when something is notably good, bad, or confusing, or when you need to see visual details such as colors, icons, or status dots. You receive the screenshot as an image.
- Small details (status dots, tiny icons) are easy to miss on a full screenshot. Use browser_zoom with a visible text next to them, e.g. a person's name, to look closely, or browser_inspect to read the markup around that text.

When you are done, return only valid JSON in this exact shape:

{
  "verdict": "passed" | "failed" | "gave_up" | "limit_reached",
  "evidence": {
    "finalUrl": "URL of the page where you ended",
    "quote": "exact text visible on that page that proves the outcome"
  },
  "frictionPoints": ["each moment you hesitated, got lost, or were annoyed, in one short sentence"],
  "quote": "one sentence in this persona's voice that sums up the experience"
}

Verdict rules:
- "passed" only if the success criterion is visibly met. Be honest; your claim is checked afterwards.
- "failed" if you are convinced the goal cannot be reached on this site.
- "gave_up" if this persona would stop trying.
- "limit_reached" if the step or time budget ran out first.
Do not include markdown, commentary, code fences, or extra keys.
${JSON_STRING_RULE}
${reportLanguageInstruction(reportLanguage)}
`.trim();
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

// agent-browser prints string results JSON-quoted, so the payload may be encoded twice.
function parseEvalJson<T = ScrollResult>(stdout: string): T {
  let parsed: unknown = JSON.parse(stdout.trim());

  if (typeof parsed === "string") {
    parsed = JSON.parse(parsed);
  }

  return parsed as T;
}

function getBrowserSessionName(runId: string, cellId: string) {
  return `${runId}-${cellId}`;
}

const AGENT_BROWSER_TIMEOUT_MS = 90_000;

// Resolves on "exit", not "close": the first command of a session spawns a daemon
// that inherits stdout/stderr, so the pipes never close and "close" never fires.
function runAgentBrowser(
  args: string[],
  { stdin, timeoutMs = AGENT_BROWSER_TIMEOUT_MS }: { stdin?: string; timeoutMs?: number } = {},
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(AGENT_BROWSER_BIN, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();

      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`agent-browser ${args.join(" ")} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      // Give buffered output a moment to arrive before the streams are destroyed.
      setTimeout(() => {
        finish(
          code === 0
            ? undefined
            : new Error(
                `agent-browser ${args.join(" ")} failed (${code}): ${(stderr || stdout).trim()}`,
              ),
        );
      }, 50);
    });

    child.stdin.end(stdin ?? "");
  });
}

// The auth vault is a shared file; serialize writes so parallel personas do not race on it.
let authVaultQueue: Promise<unknown> = Promise.resolve();

function withAuthVault<T>(task: () => Promise<T>) {
  const next = authVaultQueue.then(task, task);

  authVaultQueue = next.catch(() => undefined);

  return next;
}

// Logs the browser session in before the agent starts, so the model never sees the password.
async function loginPersona(browserSession: string, login: PersonaLogin) {
  const saveArgs = [
    "auth",
    "save",
    browserSession,
    "--url",
    login.loginUrl,
    "--username",
    login.username,
    "--password-stdin",
  ];

  if (login.usernameSelector) {
    saveArgs.push("--username-selector", login.usernameSelector);
  }

  if (login.passwordSelector) {
    saveArgs.push("--password-selector", login.passwordSelector);
  }

  if (login.submitSelector) {
    saveArgs.push("--submit-selector", login.submitSelector);
  }

  await withAuthVault(() =>
    runAgentBrowser(["--session", browserSession, ...saveArgs], { stdin: login.password }),
  );

  try {
    if (login.basicAuth) {
      await passBasicAuthGate(browserSession, login.loginUrl, login.basicAuth);
    }

    await submitLoginWithRetry(browserSession, login);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    throw new Error(`Login as ${login.username} failed: ${message}`);
  } finally {
    await withAuthVault(() =>
      runAgentBrowser(["--session", browserSession, "auth", "delete", browserSession]),
    ).catch(() => undefined);
  }
}

const LOGIN_CHECK_ATTEMPTS = 8;
const LOGIN_CHECK_INTERVAL_MS = 1000;

type LoginPageState = {
  path: string;
  appError: boolean;
  marker: boolean | null;
  alert: string;
};

async function readLoginPageState(
  browserSession: string,
  loggedInSelector: string | undefined,
): Promise<LoginPageState> {
  // #blazor-error-ui is the "An unhandled error has occurred" banner of Blazor apps.
  const script = `(() => {
    const banner = document.getElementById("blazor-error-ui");
    const appError = !!banner && getComputedStyle(banner).display !== "none";
    const selector = ${JSON.stringify(loggedInSelector ?? null)};
    return JSON.stringify({
      path: location.pathname,
      appError,
      marker: selector ? !!document.querySelector(selector) : null,
      alert: [...document.querySelectorAll('[role="alert"]')]
        .map((node) => node.textContent.trim())
        .filter(Boolean)
        .join(" ")
        .slice(0, 200),
    });
  })()`;
  const { stdout } = await runAgentBrowser(["--session", browserSession, "eval", script]);
  let parsed: unknown = JSON.parse(stdout.trim());

  // agent-browser prints string results JSON-quoted, so the payload may be encoded twice.
  if (typeof parsed === "string") {
    parsed = JSON.parse(parsed);
  }

  return parsed as LoginPageState;
}

// Answers the Basic Auth gate from Node and hands only the resulting gate cookies to the
// browser. "agent-browser set credentials" would instead force Authorization: Basic onto
// every request and overwrite the Bearer token the app sends to its own API.
async function passBasicAuthGate(browserSession: string, loginUrl: string, basicAuth: BasicAuth) {
  const authorization = `Basic ${Buffer.from(`${basicAuth.username}:${basicAuth.password}`).toString("base64")}`;
  const response = await fetch(loginUrl, {
    headers: { Authorization: authorization },
    redirect: "manual",
  });

  if (response.status === 401) {
    throw new Error("The HTTP Basic Auth gate rejected the configured basicAuth credentials.");
  }

  const cookies = response.headers.getSetCookie();

  if (cookies.length === 0) {
    // No gate cookie: fall back to browser-level credentials (may clash with Bearer APIs).
    await runAgentBrowser([
      "--session",
      browserSession,
      "set",
      "credentials",
      basicAuth.username,
      basicAuth.password,
    ]).catch(() => {
      // Do not echo the command line: it contains the Basic Auth password.
      throw new Error("Setting HTTP Basic Auth credentials failed.");
    });
    return;
  }

  const { origin } = new URL(loginUrl);

  for (const cookie of cookies) {
    const [pair, ...attributes] = cookie.split(";").map((part) => part.trim());
    const separator = pair.indexOf("=");
    const flags = attributes.map((attribute) => attribute.toLowerCase());
    const args = [
      "--session",
      browserSession,
      "cookies",
      "set",
      pair.slice(0, separator),
      pair.slice(separator + 1),
      "--url",
      origin,
    ];

    if (flags.includes("httponly")) {
      args.push("--httpOnly");
    }

    if (flags.includes("secure")) {
      args.push("--secure");
    }

    await runAgentBrowser(args).catch(() => {
      // Do not echo the command line: it contains the gate cookie value.
      throw new Error(`Setting gate cookie ${pair.slice(0, separator)} failed.`);
    });
  }
}

class StillOnLoginPageError extends Error {
  constructor(alert: string | undefined) {
    super(
      alert
        ? `Still on the login page after submitting. The page says: "${alert}"`
        : "Still on the login page after submitting. Check username, password and selectors.",
    );
  }
}

const LOGIN_ATTEMPTS = 2;

// A client-side app may not be interactive yet when the form is submitted, so the click
// is lost. Retry once when the page simply stayed on the login form.
async function submitLoginWithRetry(browserSession: string, login: PersonaLogin) {
  for (let attempt = 1; attempt <= LOGIN_ATTEMPTS; attempt += 1) {
    await runAgentBrowser(["--session", browserSession, "auth", "login", browserSession]);

    try {
      await verifyLogin(browserSession, login);
      return;
    } catch (error) {
      if (!(error instanceof StillOnLoginPageError) || attempt === LOGIN_ATTEMPTS) {
        throw error;
      }
    }
  }
}

// auth login reports success as soon as the form was submitted. Watch the page for a few
// seconds and fail if it stays on the login page or the app shows its error banner.
async function verifyLogin(browserSession: string, login: PersonaLogin) {
  const loginPath = new URL(login.loginUrl).pathname.replace(/\/$/, "");
  let state: LoginPageState | undefined;

  for (let attempt = 0; attempt < LOGIN_CHECK_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, LOGIN_CHECK_INTERVAL_MS));
    state = await readLoginPageState(browserSession, login.loggedInSelector);

    if (state.appError) {
      throw new Error(
        `The app showed an unhandled error after login (page ${state.path}). Check the browser console of the site under test.`,
      );
    }
  }

  if (!state || state.path.replace(/\/$/, "") === loginPath) {
    throw new StillOnLoginPageError(state?.alert);
  }

  if (state.marker === false) {
    throw new Error(`Logged-in marker ${login.loggedInSelector} not found on ${state.path}.`);
  }
}

async function closeBrowserSession(browserSession: string) {
  await runAgentBrowser(["--session", browserSession, "close"], {
    timeoutMs: 30_000,
  });
}
