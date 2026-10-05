import { appendCellAction, appendCellObservation } from "@/lib/runs";
import type { StepBudget } from "@/lib/scenario-verdict";

import type { ExecResult, ToolRunner } from "@/lib/drivers/types";

// Refused actions tolerated after the budget ran out, before the session is aborted.
const MAX_BLOCKED_ACTIONS = 3;

const TIME_UP_MESSAGE =
  "Time is up. Do not call any more tools. Return your final JSON report now.";
const STEP_LIMIT_MESSAGE =
  "Step budget exhausted. Do not call any more browser actions. Return your final JSON report now.";

export function createToolRunner({
  budget,
  cellId,
  control,
  exec,
  runId,
}: {
  budget: StepBudget;
  cellId: string;
  control: { timedOut: boolean; abort: () => void };
  exec: (args: string[]) => Promise<ExecResult>;
  runId: string;
}): ToolRunner {
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
      const result = await exec(args);
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

  return runTool;
}
