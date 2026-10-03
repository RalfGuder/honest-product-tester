import { spawn } from "node:child_process";
import path from "node:path";

import { Type } from "@sinclair/typebox";
import {
  AuthStorage,
  createAgentSession,
  defineTool,
  ModelRegistry,
  SessionManager,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";

import { getPersonaLogin, type BasicAuth, type PersonaLogin } from "@/lib/credentials";
import { getPersonas, type Persona } from "@/lib/personas";
import {
  appendPersonaAction,
  appendPersonaObservation,
  getRun,
  getScreenshotDir,
  updatePersonaRecord,
  updateRunManifest,
  writePersonaReport,
} from "@/lib/runs";
import {
  REPORT_INSIGHT_DEFINITIONS,
  type PersonaReportInsight,
} from "@/lib/report-insights";

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
  const runPersonas = manifest.personas
    .map((personaId) => personas.find((item) => item.id === personaId))
    .filter((persona): persona is Persona => Boolean(persona));

  await updateRunManifest(runId, (current) => ({
    ...current,
    status: "running",
    startedAt: current.startedAt ?? new Date().toISOString(),
  }));

  try {
    const results = await Promise.allSettled(
      runPersonas.map((persona) => runPersona(runId, manifest.url, persona)),
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
  } finally {
    await Promise.allSettled(
      runPersonas.map((persona) => closeBrowserSession(runId, persona.id)),
    );
  }
}

async function runPersona(runId: string, url: string, persona: Persona) {
  const browserSession = getBrowserSessionName(runId, persona.id);

  await updatePersonaRecord(runId, persona.id, (current) => ({
    ...current,
    status: "running",
    startedAt: current.startedAt ?? new Date().toISOString(),
    summary: "Launching Pi session and browser tools.",
  }));
  await appendPersonaObservation(runId, persona.id, "Persona run started.");

  const screenshotDir = getScreenshotDir(runId);
  let reportText = "";
  let providerError: string | undefined;

  const tools = createBrowserTools({
    browserSession,
    persona,
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

  const unsubscribe = session.subscribe((event) => {
    void handleSessionEvent(runId, persona.id, event);
    const eventProviderError = getProviderError(event);

    if (eventProviderError) {
      providerError = eventProviderError;
    }

    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      reportText += event.assistantMessageEvent.delta;
    }
  });

  try {
    const login = await getPersonaLogin(persona.id);

    if (login) {
      await updatePersonaRecord(runId, persona.id, (current) => ({
        ...current,
        summary: `Logging in as ${login.username}.`,
      }));
      await loginPersona(browserSession, login);
      await appendPersonaObservation(
        runId,
        persona.id,
        `Logged in as ${login.username}.`,
      );
    }

    await session.prompt(buildPersonaPrompt(persona, url, Boolean(login)));

    if (providerError) {
      throw new Error(providerError);
    }

    const structuredSummary = parseStructuredSummary(reportText);
    const finalReport = buildSummaryMarkdown(persona.name, structuredSummary);

    await updatePersonaRecord(runId, persona.id, (current) => ({
      ...current,
      status: "completed",
      completedAt: new Date().toISOString(),
      summary: "Finished browsing and captured structured feedback.",
      structuredSummary,
      finalReport,
    }));
    await writePersonaReport(runId, persona.id, finalReport);
    await appendPersonaObservation(
      runId,
      persona.id,
      "Structured persona report written to disk.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown persona failure";

    await updatePersonaRecord(runId, persona.id, (current) => ({
      ...current,
      status: "failed",
      completedAt: new Date().toISOString(),
      summary: "Persona run failed.",
      error: message,
    }));
    await writePersonaReport(
      runId,
      persona.id,
      `# ${persona.name}\n\nRun failed.\n\n${message}\n`,
    );

    throw error;
  } finally {
    unsubscribe();
    session.dispose();
    await closeBrowserSession(runId, persona.id).catch(() => undefined);
  }
}

async function handleSessionEvent(
  runId: string,
  personaId: string,
  event: AgentSessionEvent,
) {
  if (event.type === "tool_execution_start") {
    await updatePersonaRecord(runId, personaId, (current) => ({
      ...current,
      summary: `Running ${event.toolName}...`,
    }));
  }

  if (event.type === "tool_execution_end") {
    await updatePersonaRecord(runId, personaId, (current) => ({
      ...current,
      summary: event.isError
        ? `${event.toolName} failed.`
        : `${event.toolName} completed.`,
    }));
  }
}

function createBrowserTools({
  browserSession,
  persona,
  runId,
  screenshotDir,
}: {
  browserSession: string;
  persona: Persona;
  runId: string;
  screenshotDir: string;
}) {
  const runTool = async (name: string, args: string[]) => {
    const input = args.join(" ");

    try {
      const result = await runAgentBrowser(["--session", browserSession, ...args]);
      const stdout = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

      await appendPersonaAction(runId, persona.id, {
        at: new Date().toISOString(),
        tool: name,
        input,
        outcome: "success",
      });

      if (stdout) {
        await appendPersonaObservation(
          runId,
          persona.id,
          `${name}: ${stdout.slice(0, 280)}`,
        );
      }

      return stdout || "ok";
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `${name} failed unexpectedly`;

      await appendPersonaAction(runId, persona.id, {
        at: new Date().toISOString(),
        tool: name,
        input,
        outcome: "error",
      });
      await appendPersonaObservation(runId, persona.id, `${name} error: ${message}`);

      throw error;
    }
  };

  return [
    defineTool({
      name: "browser_open",
      label: "Browser Open",
      description: "Open a URL in agent-browser.",
      parameters: Type.Object({
        url: Type.String({ description: "Absolute URL to open" }),
      }),
      execute: async (_toolCallId, params) => ({
        content: [{ type: "text", text: await runTool("browser_open", ["open", params.url]) }],
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
        content: [{ type: "text", text: await runTool("browser_click", ["click", params.target]) }],
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
            text: await runTool("browser_type", ["type", params.target, params.text]),
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
        content: [{ type: "text", text: await runTool("browser_press", ["press", params.key]) }],
        details: {},
      }),
    }),
    defineTool({
      name: "browser_scroll",
      label: "Browser Scroll",
      description: "Scroll the page up or down.",
      parameters: Type.Object({
        direction: Type.Union([Type.Literal("up"), Type.Literal("down")]),
        pixels: Type.Optional(Type.Number({ description: "Number of pixels to scroll" })),
      }),
      execute: async (_toolCallId, params) => ({
        content: [
          {
            type: "text",
            text: await runTool("browser_scroll", [
              "scroll",
              params.direction,
              `${params.pixels ?? 700}`,
            ]),
          },
        ],
        details: {},
      }),
    }),
    defineTool({
      name: "browser_wait",
      label: "Browser Wait",
      description: "Wait for a number of milliseconds.",
      parameters: Type.Object({
        ms: Type.Number({ description: "Milliseconds to wait" }),
      }),
      execute: async (_toolCallId, params) => ({
        content: [{ type: "text", text: await runTool("browser_wait", ["wait", `${params.ms}`]) }],
        details: {},
      }),
    }),
    defineTool({
      name: "browser_screenshot",
      label: "Browser Screenshot",
      description: "Capture a screenshot and save it into the run directory.",
      parameters: Type.Object({
        label: Type.String({ description: "Short screenshot label" }),
      }),
      execute: async (_toolCallId, params) => {
        const safeLabel = params.label.replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
        const fileName = `${persona.id}-${Date.now()}-${safeLabel}.png`;
        const screenshotPath = path.join(screenshotDir, fileName);
        const output = await runTool("browser_screenshot", [
          "screenshot",
          screenshotPath,
        ]);
        const screenshotTakenAt = new Date().toISOString();

        await updatePersonaRecord(runId, persona.id, (current) => ({
          ...current,
          latestScreenshotFileName: fileName,
          latestScreenshotTakenAt: screenshotTakenAt,
          summary: `Captured screenshot: ${params.label}`,
        }));

        return {
          content: [{ type: "text", text: `${output}\nSaved to ${screenshotPath}` }],
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

function buildPersonaPrompt(persona: Persona, url: string, loggedIn: boolean) {
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
- Use browser_screenshot when something is notably good, bad, or confusing.
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

function buildSummaryMarkdown(
  personaName: string,
  structuredSummary: PersonaReportInsight[],
) {
  const bullets = REPORT_INSIGHT_DEFINITIONS.map(({ id, title }) => {
    const insight = structuredSummary.find((item) => item.id === id);

    if (!insight) {
      throw new Error(`Missing structured insight for "${id}".`);
    }

    return `- **${title}:** ${insight.answer}`;
  }).join("\n");

  return `# ${personaName}\n\n${bullets}\n`;
}

function getBrowserSessionName(runId: string, personaId: string) {
  return `${runId}-${personaId}`;
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

async function closeBrowserSession(runId: string, personaId: string) {
  await runAgentBrowser(["--session", getBrowserSessionName(runId, personaId), "close"], {
    timeoutMs: 30_000,
  });
}
