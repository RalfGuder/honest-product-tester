import { describe, expect, it } from "vitest";

import {
  createStepBudget,
  parseCellReport,
  reconcileVerdict,
  type AssertionResult,
} from "@/lib/scenario-verdict";

const pass = (value = "/ok"): AssertionResult => ({ type: "url_contains", value, passed: true });
const fail = (value = "/ok"): AssertionResult => ({ type: "url_contains", value, passed: false });

describe("reconcileVerdict", () => {
  it("keeps the self verdict without assertions", () => {
    expect(reconcileVerdict("gave_up", [])).toEqual({ verdict: "gave_up", misjudged: false });
  });

  it("confirms a pass when all assertions hold", () => {
    expect(reconcileVerdict("passed", [pass(), pass()])).toEqual({
      verdict: "passed",
      misjudged: false,
    });
  });

  it("overrides a claimed pass when an assertion fails", () => {
    expect(reconcileVerdict("passed", [pass(), fail()])).toEqual({
      verdict: "failed",
      misjudged: true,
    });
  });

  it("overrides a claimed failure when all assertions hold", () => {
    expect(reconcileVerdict("failed", [pass()])).toEqual({ verdict: "passed", misjudged: true });
    expect(reconcileVerdict("gave_up", [pass()])).toEqual({ verdict: "passed", misjudged: true });
  });

  it("keeps a give-up when assertions also fail", () => {
    expect(reconcileVerdict("gave_up", [fail()])).toEqual({ verdict: "gave_up", misjudged: false });
  });

  it("upgrades a step-limit hit when assertions prove the goal", () => {
    expect(reconcileVerdict("limit_reached", [pass()])).toEqual({
      verdict: "passed",
      misjudged: false,
    });
    expect(reconcileVerdict("limit_reached", [fail()])).toEqual({
      verdict: "limit_reached",
      misjudged: false,
    });
  });

  it("never touches error or skipped", () => {
    expect(reconcileVerdict("error", [pass()])).toEqual({ verdict: "error", misjudged: false });
    expect(reconcileVerdict("skipped", [pass()])).toEqual({ verdict: "skipped", misjudged: false });
  });
});

describe("reconcileVerdict with not applicable assertions", () => {
  const notApplicable: AssertionResult = {
    type: "window_title_matches",
    value: "Done",
    passed: false,
    notApplicable: true,
  };

  it("ignores assertions that do not fit the target", () => {
    expect(reconcileVerdict("passed", [pass(), notApplicable])).toEqual({
      verdict: "passed",
      misjudged: false,
    });
  });

  it("keeps the self verdict when no assertion applies", () => {
    expect(reconcileVerdict("gave_up", [notApplicable])).toEqual({
      verdict: "gave_up",
      misjudged: false,
    });
  });
});

describe("parseCellReport", () => {
  it("parses a complete report wrapped in prose", () => {
    const raw = `Here you go:
{"verdict":"passed","evidence":{"finalUrl":"https://x.test/fav","quote":"Saved!"},
 "frictionPoints":["Save icon was tiny"," "],"quote":"Finally!"}`;

    expect(parseCellReport(raw)).toEqual({
      selfVerdict: "passed",
      evidence: { finalUrl: "https://x.test/fav", quote: "Saved!" },
      frictionPoints: ["Save icon was tiny"],
      quote: "Finally!",
    });
  });

  it("tolerates missing optional fields", () => {
    expect(parseCellReport('{"verdict":"gave_up"}')).toEqual({
      selfVerdict: "gave_up",
      evidence: {},
      frictionPoints: [],
      quote: "",
    });
  });

  it("maps a limit_reached self report", () => {
    expect(parseCellReport('{"verdict":"limit_reached"}').selfVerdict).toBe("limit_reached");
  });

  it("rejects unknown verdicts", () => {
    expect(() => parseCellReport('{"verdict":"maybe"}')).toThrow(/verdict/);
  });

  it("rejects empty or non-JSON output", () => {
    expect(() => parseCellReport("")).toThrow();
    expect(() => parseCellReport("I could not finish.")).toThrow(/JSON/);
  });
});

describe("createStepBudget", () => {
  it("allows exactly maxSteps actions", () => {
    const budget = createStepBudget(2);

    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);
    expect(budget.used).toBe(2);
    expect(budget.exhausted).toBe(true);
  });

  it("counts blocked attempts after exhaustion", () => {
    const budget = createStepBudget(1);

    budget.tryConsume();
    budget.tryConsume();
    budget.tryConsume();

    expect(budget.blocked).toBe(2);
  });
});

describe("parseCellReport desktop evidence", () => {
  it("reads the final window title", () => {
    const report = parseCellReport(
      JSON.stringify({ verdict: "passed", evidence: { finalWindow: " Export complete " } }),
    );

    expect(report.evidence).toEqual({ finalWindow: "Export complete" });
  });
});
