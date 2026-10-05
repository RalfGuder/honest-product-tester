import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import type { Locale } from "@/i18n/config";
import type { LiveMessage } from "@/i18n/live";
import type { Persona } from "@/lib/personas";
import type { Scenario, ScenarioAssertion, TargetKind } from "@/lib/scenario-format";
import type { AssertionResult, CellEvidence } from "@/lib/scenario-verdict";

export type ExecResult = { stdout: string; stderr: string };

// Runs one driver command for the agent; actions count against the step budget, reads are free.
export type ToolRunner = (
  name: string,
  args: string[],
  options?: { isAction?: boolean; display?: string },
) => Promise<string>;

// The driver keeps the resolved credentials; the executor only learns the username.
export type CellLogin = { username?: string; skipReason?: LiveMessage; notice?: LiveMessage };

// Everything the executor needs from the system under test (website, desktop app, ...).
// One driver instance belongs to one persona × scenario cell.
export interface TargetDriver {
  kind: TargetKind;
  // Loads what the persona needs for this cell (login, desktop start arguments).
  resolvePersona(persona: Persona, scenario: Scenario): Promise<CellLogin>;
  start(): Promise<void>;
  // Logs in before the agent starts, so the model never sees the password.
  login(): Promise<void>;
  exec(args: string[]): Promise<ExecResult>;
  createTools(runTool: ToolRunner): ToolDefinition[];
  buildExplorePrompt(persona: Persona, loggedIn: boolean, reportLanguage: Locale | undefined): string;
  buildMissionPrompt(
    persona: Persona,
    scenario: Scenario,
    loggedIn: boolean,
    reportLanguage: Locale | undefined,
  ): string;
  // Where the persona ended up: final URL for websites, windows for desktop apps.
  readFinalEvidence(): Promise<CellEvidence>;
  checkAssertions(
    assertions: ScenarioAssertion[],
    finalEvidence: CellEvidence,
  ): Promise<AssertionResult[]>;
  captureFinal(): Promise<void>;
  close(): Promise<void>;
}
