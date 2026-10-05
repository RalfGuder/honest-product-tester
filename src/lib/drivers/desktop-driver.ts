import { readFile } from "node:fs/promises";
import path from "node:path";

import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";

import { getDesktopPersona, type DesktopLogin } from "@/lib/credentials";
import type { DesktopTarget } from "@/lib/run-target";
import { updateCellRecord } from "@/lib/runs";
import { resolveStartArgs } from "@/lib/scenario-format";
import type { AssertionResult } from "@/lib/scenario-verdict";

import { buildMissionPrompt, buildPersonaPrompt } from "@/lib/drivers/desktop-prompts";
import { runCli } from "@/lib/drivers/spawn-cli";
import type { CellLogin, TargetDriver, ToolRunner } from "@/lib/drivers/types";
import { findElementRef, parseWindows } from "@/lib/drivers/wpf-output";

const AGENT_WPF_TIMEOUT_MS = 90_000;
// Time an app gets to show its first window; slow .NET apps need more than agent-wpf's 30 s.
const OPEN_TIMEOUT_MS = 60_000;
const LOGIN_WINDOW_TIMEOUT_MS = 30_000;
// Upper limit for desktop_wait, so a persona cannot block its cell for long.
const WAIT_LIMIT_MS = 30_000;

type PlannedScreenshot = { fileName: string; screenshotPath: string; args: string[] };

export const REAL_INPUT_DISABLED_MESSAGE =
  "Real mouse/keyboard input is disabled while several testers share this desktop. Use the tools without realInput.";

export function getAgentWpfBin() {
  return process.env.AGENT_WPF_BIN || "agent-wpf";
}

/** Fails with a readable message when desktop runs cannot work on this machine. */
export async function preflightAgentWpf() {
  if (process.platform !== "win32") {
    throw new Error(`Desktop targets need Windows; this server runs on ${process.platform}.`);
  }

  const bin = getAgentWpfBin();

  try {
    await runCli(bin, "agent-wpf", ["--version"], { timeoutMs: 15_000 });
  } catch (error) {
    throw new Error(
      `agent-wpf is not available (${bin}): ${error instanceof Error ? error.message : "unknown error"}. Install it or set AGENT_WPF_BIN.`,
    );
  }
}

// Drives a Windows desktop app through agent-wpf; one session and app instance per cell.
export function createDesktopDriver({
  cellId,
  realInput,
  runId,
  screenshotDir,
  target,
}: {
  cellId: string;
  // Real mouse/keyboard moves the shared cursor; only allowed when one tester runs at a time.
  realInput: boolean;
  runId: string;
  screenshotDir: string;
  target: DesktopTarget;
}): TargetDriver {
  const session = `${runId}-${cellId}`;
  const bin = getAgentWpfBin();
  let desktopLogin: DesktopLogin | undefined;
  let appArgs = target.args;

  const wpf = (
    args: string[],
    options: { cwd?: string; secret?: boolean; timeoutMs?: number } = {},
  ) =>
    runCli(bin, "agent-wpf", ["--session", session, ...args], {
      timeoutMs: AGENT_WPF_TIMEOUT_MS,
      ...options,
    });

  // File name and agent-wpf arguments for a screenshot of the active window or one control.
  const planScreenshot = (label: string, element?: string): PlannedScreenshot => {
    const safeLabel = label.replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
    const fileName = `${cellId}-${Date.now()}-${safeLabel}.png`;
    const screenshotPath = path.join(screenshotDir, fileName);

    return {
      fileName,
      screenshotPath,
      args: ["screenshot", screenshotPath, ...(element ? ["--element", element] : [])],
    };
  };

  return {
    kind: "desktop",
    resolvePersona: async (persona, cellScenario): Promise<CellLogin> => {
      let settings: Awaited<ReturnType<typeof getDesktopPersona>>;

      try {
        // Read even for anonymous scenarios: the persona's start arguments still apply.
        settings = await getDesktopPersona(persona.id, target.appId);
      } catch (error) {
        if (cellScenario.login !== "required") {
          throw error;
        }

        return {
          skipReason: {
            key: "loginRequiredError",
            params: { error: error instanceof Error ? error.message : "no credentials" },
          },
        };
      }

      appArgs = resolveStartArgs({
        appArgs: target.args,
        personaArgs: settings.args,
        scenario: cellScenario,
        personaId: persona.id,
      });

      if (cellScenario.login === "anonymous") {
        return {};
      }

      if (!settings.login) {
        return cellScenario.login === "required"
          ? { skipReason: { key: "loginRequiredNoApp", params: { app: target.appName } } }
          : {};
      }

      desktopLogin = settings.login;

      return { username: desktopLogin.username };
    },
    start: async () => {

      // agent-wpf starts the app in its own working directory (RalfGuder/agent-wpf#5).
      await wpf(
        [
          "open",
          target.exePath,
          "--timeout",
          `${OPEN_TIMEOUT_MS}`,
          ...(appArgs.length > 0 ? ["--", ...appArgs] : []),
        ],
        {
          cwd: target.workingDir ?? path.dirname(target.exePath),
          timeoutMs: OPEN_TIMEOUT_MS + 15_000,
        },
      );
    },
    login: async () => {
      if (!desktopLogin) {
        return;
      }

      const login = desktopLogin;

      try {
        await loginToApp(login);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";

        throw new Error(`Login as ${login.username} failed: ${message}`);
      }
    },
    exec: (args) => wpf(args),
    createTools: (runTool) =>
      createDesktopTools({
        cellId,
        realInput,
        runId,
        runTool,
        planScreenshot,
      }),
    buildExplorePrompt: (persona, loggedIn, reportLanguage) =>
      buildPersonaPrompt(persona, target.appName, loggedIn, reportLanguage),
    buildMissionPrompt: (persona, cellScenario, loggedIn, reportLanguage) =>
      buildMissionPrompt(persona, cellScenario, target.appName, loggedIn, reportLanguage),
    readFinalEvidence: async () => {
      const windows = parseWindows((await wpf(["windows"])).stdout);
      const active = windows.find((window) => window.active) ?? windows[0];

      return { finalWindow: active?.title, openWindows: windows.map((window) => window.title) };
    },
    checkAssertions: async (assertions, { finalWindow }) => {
      const results: AssertionResult[] = [];

      for (const assertion of assertions) {
        try {
          if (assertion.type === "window_title_matches") {
            results.push({
              ...assertion,
              passed: finalWindow !== undefined && new RegExp(assertion.value).test(finalWindow),
              detail: finalWindow ?? "No window was open at the end.",
            });
            continue;
          }

          const { stdout } = await wpf(["snapshot", "--all-windows"]);

          results.push({ ...assertion, passed: stdout.includes(assertion.value) });
        } catch (error) {
          results.push({
            ...assertion,
            passed: false,
            detail: error instanceof Error ? error.message : "Check failed.",
          });
        }
      }

      return results;
    },
    captureFinal: async () => {
      const { fileName, args } = planScreenshot("final");

      await wpf(args);
      await updateCellRecord(runId, cellId, (current) => ({
        ...current,
        latestScreenshotFileName: fileName,
        latestScreenshotTakenAt: new Date().toISOString(),
      }));
    },
    close: async () => {
      await wpf(["close", "--kill"], { timeoutMs: 30_000 }).catch(() => undefined);
      // Each session has its own daemon; stop it instead of waiting for its idle hour.
      await wpf(["session", "stop"], { timeoutMs: 30_000 }).catch(() => undefined);
    },
  };

  // Fills the login dialog before the agent starts, so the model never sees the password.
  async function loginToApp(login: DesktopLogin) {
    // Configured fields are AutomationIds or names; agent-wpf only takes refs (RalfGuder/agent-wpf#3).
    const { stdout } = await wpf(["snapshot", "--all-windows", "-i"]);
    const findField = (selector: string, role: string) => {
      const ref = findElementRef(stdout, selector);

      if (!ref) {
        throw new Error(`${role} "${selector}" not found in ${target.appName}.`);
      }

      return ref;
    };
    const usernameRef = findField(login.usernameField, "Username field");
    const passwordRef = findField(login.passwordField, "Password field");
    const submitRef = findField(login.submit, "Submit button");

    await wpf(["fill", usernameRef, login.username]);
    // The password has to go through argv (RalfGuder/agent-wpf#2); keep it out of every message.
    await wpf(["fill", passwordRef, login.password], { secret: true });
    await wpf(["click", submitRef]);

    if (login.loggedInWindow) {
      await wpf(
        ["wait", "--window", login.loggedInWindow, "--timeout", `${LOGIN_WINDOW_TIMEOUT_MS}`],
        { timeoutMs: LOGIN_WINDOW_TIMEOUT_MS + 15_000 },
      ).catch(() => {
        throw new Error(
          `The window "${login.loggedInWindow}" did not open within ${LOGIN_WINDOW_TIMEOUT_MS / 1000} s. Check username, password and loggedInWindow.`,
        );
      });
    }
  }
}

const ref = (description = "Ref like @e3 from the latest desktop_snapshot") =>
  Type.String({ description });
const realInputParam = Type.Optional(
  Type.Boolean({
    description:
      "Use the real mouse/keyboard. Only when the normal action failed with a hint about --input.",
  }),
);

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: {} };
}

function createDesktopTools({
  cellId,
  realInput,
  runId,
  runTool,
  planScreenshot,
}: {
  cellId: string;
  realInput: boolean;
  runId: string;
  runTool: ToolRunner;
  planScreenshot: (label: string, element?: string) => PlannedScreenshot;
}) {
  const action = { isAction: true };
  const requireRealInput = () => {
    if (!realInput) {
      throw new Error(REAL_INPUT_DISABLED_MESSAGE);
    }

    return ["--input"];
  };

  return [
    defineTool({
      name: "desktop_snapshot",
      label: "Desktop Snapshot",
      description:
        "Get the UI Automation tree of the active window with refs (@e3). Interactive controls only by default.",
      parameters: Type.Object({
        interactive: Type.Optional(
          Type.Boolean({ description: "Only actionable controls (default true). False shows texts and labels too." }),
        ),
        depth: Type.Optional(Type.Number({ description: "Maximum depth below the window" })),
        scope: Type.Optional(ref("Only the subtree of this ref")),
        allWindows: Type.Optional(Type.Boolean({ description: "Render every window of the app" })),
      }),
      execute: async (_toolCallId, params) =>
        text(
          await runTool("desktop_snapshot", [
            "snapshot",
            ...(params.interactive === false ? [] : ["-i"]),
            ...(params.depth ? ["-d", `${params.depth}`] : []),
            ...(params.scope ? ["-s", params.scope] : []),
            ...(params.allWindows ? ["--all-windows"] : []),
          ]),
        ),
    }),
    defineTool({
      name: "desktop_click",
      label: "Desktop Click",
      description:
        "Click a control: presses buttons and menu items, toggles check boxes, selects list or tab items, expands tree items.",
      parameters: Type.Object({ target: ref(), realInput: realInputParam }),
      execute: async (_toolCallId, params) =>
        text(
          await runTool(
            "desktop_click",
            ["click", params.target, ...(params.realInput ? requireRealInput() : [])],
            action,
          ),
        ),
    }),
    defineTool({
      name: "desktop_fill",
      label: "Desktop Fill",
      description: "Replace the text of a text field.",
      parameters: Type.Object({
        target: ref(),
        text: Type.String({ description: "New text" }),
        realInput: realInputParam,
      }),
      execute: async (_toolCallId, params) =>
        text(
          await runTool(
            "desktop_fill",
            ["fill", params.target, params.text, ...(params.realInput ? requireRealInput() : [])],
            action,
          ),
        ),
    }),
    defineTool({
      name: "desktop_select",
      label: "Desktop Select",
      description: "Pick an option of a combo box or list by its visible text.",
      parameters: Type.Object({
        target: ref(),
        option: Type.String({ description: "Visible text of the option" }),
      }),
      execute: async (_toolCallId, params) =>
        text(
          await runTool("desktop_select", ["select", params.target, params.option], action),
        ),
    }),
    defineTool({
      name: "desktop_set_checked",
      label: "Desktop Set Checked",
      description: "Check or uncheck a check box, or select a radio button.",
      parameters: Type.Object({ target: ref(), checked: Type.Boolean() }),
      execute: async (_toolCallId, params) =>
        text(
          await runTool(
            "desktop_set_checked",
            [params.checked ? "check" : "uncheck", params.target],
            action,
          ),
        ),
    }),
    defineTool({
      name: "desktop_set_expanded",
      label: "Desktop Set Expanded",
      description: "Expand or collapse a tree item, combo box or menu.",
      parameters: Type.Object({ target: ref(), expanded: Type.Boolean() }),
      execute: async (_toolCallId, params) =>
        text(
          await runTool(
            "desktop_set_expanded",
            [params.expanded ? "expand" : "collapse", params.target],
            action,
          ),
        ),
    }),
    defineTool({
      name: "desktop_press",
      label: "Desktop Press",
      description:
        "Press a key chord with the real keyboard, e.g. Enter, Escape, Tab, Control+S. Optionally focus a control first.",
      parameters: Type.Object({
        keys: Type.String({ description: "Keys joined with +, e.g. Control+S" }),
        target: Type.Optional(ref("Control to focus first")),
      }),
      execute: async (_toolCallId, params) => {
        requireRealInput();

        return text(
          await runTool(
            "desktop_press",
            ["press", params.keys, ...(params.target ? ["--target", params.target] : [])],
            action,
          ),
        );
      },
    }),
    defineTool({
      name: "desktop_scroll",
      label: "Desktop Scroll",
      description: "Scroll a list, grid or panel.",
      parameters: Type.Object({
        target: ref("Ref of the scrollable control"),
        direction: Type.Union([
          Type.Literal("up"),
          Type.Literal("down"),
          Type.Literal("left"),
          Type.Literal("right"),
        ]),
        pages: Type.Optional(Type.Number({ description: "Pages to scroll (default 1)" })),
      }),
      execute: async (_toolCallId, params) =>
        text(
          await runTool(
            "desktop_scroll",
            [
              "scroll",
              params.target,
              params.direction,
              ...(params.pages ? ["--pages", `${params.pages}`] : []),
            ],
            action,
          ),
        ),
    }),
    defineTool({
      name: "desktop_wait",
      label: "Desktop Wait",
      description: `Wait until a text or a window appears (preferred), or for a number of milliseconds. Gives up after ${WAIT_LIMIT_MS / 1000} s.`,
      parameters: Type.Object({
        text: Type.Optional(Type.String({ description: "Text that should appear" })),
        window: Type.Optional(Type.String({ description: "Regex for the title of a window that should open" })),
        ms: Type.Optional(Type.Number({ description: "Milliseconds, only as a last resort" })),
      }),
      execute: async (_toolCallId, params) => {
        const timeout = ["--timeout", `${WAIT_LIMIT_MS}`];
        const args = params.text
          ? ["wait", "--text", params.text, ...timeout]
          : params.window
            ? ["wait", "--window", params.window, ...timeout]
            : ["wait", `${Math.min(Math.max(params.ms ?? 1000, 0), WAIT_LIMIT_MS)}`];

        return text(await runTool("desktop_wait", args, action));
      },
    }),
    defineTool({
      name: "desktop_switch_window",
      label: "Desktop Switch Window",
      description: "Make another window of the app the active one for snapshots and screenshots.",
      parameters: Type.Object({ target: ref("Window ref from desktop_windows") }),
      execute: async (_toolCallId, params) =>
        text(await runTool("desktop_switch_window", ["window", params.target], action)),
    }),
    defineTool({
      name: "desktop_windows",
      label: "Desktop Windows",
      description: "List all windows of the app with refs; marks modal, popup and active windows.",
      parameters: Type.Object({}),
      execute: async () => text(await runTool("desktop_windows", ["windows"])),
    }),
    defineTool({
      name: "desktop_table",
      label: "Desktop Table",
      description: "Read rows of a data grid or list, including rows that are not visible yet.",
      parameters: Type.Object({
        target: ref("Ref of the grid"),
        rows: Type.Optional(Type.String({ description: "Row range like 0-49 (default), at most 500 rows" })),
      }),
      execute: async (_toolCallId, params) =>
        text(
          await runTool("desktop_table", [
            "table",
            params.target,
            ...(params.rows ? ["--rows", params.rows] : []),
          ]),
        ),
    }),
    defineTool({
      name: "desktop_get_value",
      label: "Desktop Get Value",
      description: "Read the full value of a control (text fields, combo boxes, sliders).",
      parameters: Type.Object({ target: ref() }),
      execute: async (_toolCallId, params) =>
        text(await runTool("desktop_get_value", ["get", "value", params.target])),
    }),
    defineTool({
      name: "desktop_screenshot",
      label: "Desktop Screenshot",
      description:
        "Capture a screenshot of the active window, or of one control. You receive the image, so use it whenever visual details matter (colors, icons, layout).",
      parameters: Type.Object({
        label: Type.String({ description: "Short screenshot label" }),
        target: Type.Optional(ref("Only this control")),
      }),
      execute: async (_toolCallId, params) => {
        const { fileName, screenshotPath, args } = planScreenshot(params.label, params.target);
        const output = await runTool("desktop_screenshot", args);

        await updateCellRecord(runId, cellId, (current) => ({
          ...current,
          latestScreenshotFileName: fileName,
          latestScreenshotTakenAt: new Date().toISOString(),
          summary: { key: "screenshotCaptured", params: { label: params.label } },
        }));

        const image = await readFile(screenshotPath).catch(() => undefined);

        return {
          content: [
            { type: "text" as const, text: `${output}\nSaved to ${screenshotPath}` },
            ...(image
              ? [{ type: "image" as const, data: image.toString("base64"), mimeType: "image/png" }]
              : []),
          ],
          details: {},
        };
      },
    }),
  ];
}
