import { readFile } from "node:fs/promises";
import path from "node:path";

import { Type } from "@sinclair/typebox";
import sharp from "sharp";
import { defineTool } from "@mariozechner/pi-coding-agent";

import { getPersonaLogin, type BasicAuth, type PersonaLogin } from "@/lib/credentials";
import type { LiveMessage } from "@/i18n/live";
import type { Persona } from "@/lib/personas";
import { updateCellRecord } from "@/lib/runs";
import { buildScrollScript, describeScroll, type ScrollResult } from "@/lib/browser-scroll";
import { buildInspectScript, describeInspect, type InspectResult } from "@/lib/browser-inspect";
import { buildFocusScript, toCropRegion, type FocusResult } from "@/lib/browser-zoom";
import type { Scenario, ScenarioAssertion } from "@/lib/scenario-format";
import type { AssertionResult } from "@/lib/scenario-verdict";

import { runCli } from "@/lib/drivers/spawn-cli";
import type { TargetDriver, ToolRunner } from "@/lib/drivers/types";
import { buildMissionPrompt, buildPersonaPrompt } from "@/lib/drivers/web-prompts";

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
// browser_zoom enlarges the area around a text so tiny details (status dots, icons) survive
// the downscaling the model applies to images.
const ZOOM_FACTOR = 3;
const ZOOM_DEFAULT_MARGIN = 120;

// Drives a website through agent-browser; one browser session per cell.
export function createWebDriver({
  cellId,
  runId,
  screenshotDir,
  startUrl,
}: {
  cellId: string;
  runId: string;
  screenshotDir: string;
  startUrl: string;
}): TargetDriver {
  const browserSession = getBrowserSessionName(runId, cellId);
  let personaLogin: PersonaLogin | undefined;

  return {
    kind: "web",
    resolvePersona: async (persona, scenario) => {
      const { value, ...rest } = await resolveCellLogin(persona, scenario, startUrl);

      personaLogin = value;

      return { ...rest, username: value?.username };
    },
    // agent-browser starts its daemon with the first command, nothing to launch up front.
    start: async () => {},
    login: async () => {
      if (personaLogin) {
        await loginPersona(browserSession, personaLogin);
      }
    },
    exec: (args) => runAgentBrowser(["--session", browserSession, ...args]),
    createTools: (runTool) => createBrowserTools({ cellId, runId, runTool, screenshotDir }),
    buildExplorePrompt: (persona, loggedIn, reportLanguage) =>
      buildPersonaPrompt(persona, startUrl, loggedIn, reportLanguage),
    buildMissionPrompt: (persona, scenario, loggedIn, reportLanguage) =>
      buildMissionPrompt(persona, scenario, startUrl, loggedIn, reportLanguage),
    readFinalEvidence: async () => ({ finalUrl: await readCurrentUrl(browserSession) }),
    checkAssertions: (assertions, { finalUrl }) =>
      checkAssertions(browserSession, assertions, finalUrl),
    captureFinal: () => captureFinalScreenshot(runId, cellId, browserSession, screenshotDir),
    close: () => closeBrowserSession(browserSession),
  };
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

function createBrowserTools({
  cellId,
  runId,
  runTool,
  screenshotDir,
}: {
  cellId: string;
  runId: string;
  runTool: ToolRunner;
  screenshotDir: string;
}) {
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

function runAgentBrowser(
  args: string[],
  { stdin, timeoutMs = AGENT_BROWSER_TIMEOUT_MS }: { stdin?: string; timeoutMs?: number } = {},
) {
  return runCli(AGENT_BROWSER_BIN, "agent-browser", args, { stdin, timeoutMs });
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
