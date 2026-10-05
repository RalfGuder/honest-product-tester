import { beforeEach, describe, expect, it, vi } from "vitest";

import { createToolRunner } from "@/lib/drivers/tool-runner";
import { appendCellAction, appendCellObservation } from "@/lib/runs";
import { createStepBudget } from "@/lib/scenario-verdict";

vi.mock("@/lib/runs", () => ({
  appendCellAction: vi.fn(async () => undefined),
  appendCellObservation: vi.fn(async () => undefined),
}));

function setup(maxSteps = 2, exec = vi.fn(async () => ({ stdout: "done", stderr: "" }))) {
  const budget = createStepBudget(maxSteps);
  const control = { timedOut: false, abort: vi.fn() };
  const runTool = createToolRunner({ budget, cellId: "cell", control, exec, runId: "run" });

  return { budget, control, exec, runTool };
}

describe("createToolRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the args to exec and returns its output", async () => {
    const { exec, runTool } = setup();

    await expect(runTool("browser_click", ["click", "@e1"])).resolves.toBe("done");
    expect(exec).toHaveBeenCalledWith(["click", "@e1"]);
    expect(appendCellAction).toHaveBeenCalledWith(
      "run",
      "cell",
      expect.objectContaining({ tool: "browser_click", input: "click @e1", outcome: "success" }),
    );
  });

  it("logs the display text instead of long args", async () => {
    const { runTool } = setup();

    await runTool("browser_scroll", ["eval", "<script>"], { display: "down 700" });
    expect(appendCellAction).toHaveBeenCalledWith(
      "run",
      "cell",
      expect.objectContaining({ input: "down 700" }),
    );
  });

  it("returns ok when the command prints nothing", async () => {
    const { runTool } = setup(2, vi.fn(async () => ({ stdout: "", stderr: "" })));

    await expect(runTool("browser_wait", ["wait", "100"])).resolves.toBe("ok");
    expect(appendCellObservation).not.toHaveBeenCalled();
  });

  it("counts only actions against the step budget", async () => {
    const { budget, runTool } = setup();

    await runTool("browser_snapshot", ["snapshot"]);
    await runTool("browser_click", ["click", "@e1"], { isAction: true });

    expect(budget.used).toBe(1);
  });

  it("refuses actions once the budget is used up and aborts after too many refusals", async () => {
    const { control, exec, runTool } = setup(1);

    await runTool("browser_click", ["click", "@e1"], { isAction: true });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(runTool("browser_click", ["click", "@e2"], { isAction: true })).rejects.toThrow(
        /Step budget exhausted/,
      );
    }

    expect(control.abort).not.toHaveBeenCalled();

    await expect(runTool("browser_click", ["click", "@e2"], { isAction: true })).rejects.toThrow(
      /Step budget exhausted/,
    );
    expect(control.abort).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("refuses every tool once the time is up", async () => {
    const { control, exec, runTool } = setup();

    control.timedOut = true;

    await expect(runTool("browser_snapshot", ["snapshot"])).rejects.toThrow(/Time is up/);
    expect(exec).not.toHaveBeenCalled();
  });

  it("logs a failed command and rethrows its error", async () => {
    const failure = new Error("agent-browser click @e9 failed (1): no element");
    const { runTool } = setup(
      2,
      vi.fn(async () => {
        throw failure;
      }),
    );

    await expect(runTool("browser_click", ["click", "@e9"], { isAction: true })).rejects.toBe(
      failure,
    );
    expect(appendCellAction).toHaveBeenCalledWith(
      "run",
      "cell",
      expect.objectContaining({ outcome: "error" }),
    );
    expect(appendCellObservation).toHaveBeenCalledWith("run", "cell", {
      key: "toolError",
      params: { tool: "browser_click", error: failure.message },
    });
  });
});
