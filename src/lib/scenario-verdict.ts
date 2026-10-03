import type { LiveMessage } from "@/i18n/live";
import type { ScenarioAssertion } from "@/lib/scenario-format";

export const VERDICTS = [
  "passed",
  "failed",
  "gave_up",
  "limit_reached",
  "error",
  "skipped",
] as const;

export type Verdict = (typeof VERDICTS)[number];

// Verdicts a persona may report about itself; the others are decided by the executor.
const SELF_VERDICTS: readonly Verdict[] = ["passed", "failed", "gave_up", "limit_reached"];

export type AssertionResult = ScenarioAssertion & {
  passed: boolean;
  detail?: string;
};

export type CellEvidence = {
  finalUrl?: string;
  quote?: string;
};

export type ParsedCellReport = {
  selfVerdict: Verdict;
  evidence: CellEvidence;
  frictionPoints: string[];
  quote: string;
};

export type CellReport = {
  verdict: Verdict;
  selfVerdict?: Verdict;
  // True when the assertions contradicted the persona's own verdict.
  misjudged: boolean;
  evidence: CellEvidence;
  stepsUsed: number;
  maxSteps: number;
  frictionPoints: string[];
  quote: string;
  assertionResults: AssertionResult[];
  // English note for the Markdown report; noteMessage is its translatable form for the UI.
  note?: string;
  noteMessage?: LiveMessage;
};

/**
 * Combines the persona's own verdict with the code-checked assertions.
 * Assertions win: they are the only objective signal about the end state.
 */
export function reconcileVerdict(
  selfVerdict: Verdict,
  assertionResults: AssertionResult[],
): { verdict: Verdict; misjudged: boolean } {
  if (
    assertionResults.length === 0 ||
    selfVerdict === "error" ||
    selfVerdict === "skipped"
  ) {
    return { verdict: selfVerdict, misjudged: false };
  }

  const allPassed = assertionResults.every((result) => result.passed);

  if (selfVerdict === "limit_reached") {
    return { verdict: allPassed ? "passed" : "limit_reached", misjudged: false };
  }

  if (selfVerdict === "passed") {
    return allPassed
      ? { verdict: "passed", misjudged: false }
      : { verdict: "failed", misjudged: true };
  }

  return allPassed
    ? { verdict: "passed", misjudged: true }
    : { verdict: selfVerdict, misjudged: false };
}

export function parseCellReport(rawText: string): ParsedCellReport {
  const candidate = rawText.trim();

  if (!candidate) {
    throw new Error("Persona returned no scenario report.");
  }

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace < firstBrace) {
    throw new Error("Persona scenario report was not valid JSON.");
  }

  const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  const verdict = parsed.verdict;

  if (!SELF_VERDICTS.includes(verdict as Verdict)) {
    throw new Error(`Persona scenario report has an invalid verdict: ${String(verdict)}`);
  }

  const evidence = (parsed.evidence ?? {}) as Record<string, unknown>;
  const result: CellEvidence = {};

  if (typeof evidence.finalUrl === "string" && evidence.finalUrl.trim()) {
    result.finalUrl = evidence.finalUrl.trim();
  }

  if (typeof evidence.quote === "string" && evidence.quote.trim()) {
    result.quote = evidence.quote.trim();
  }

  return {
    selfVerdict: verdict as Verdict,
    evidence: result,
    frictionPoints: Array.isArray(parsed.frictionPoints)
      ? parsed.frictionPoints
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
    quote: typeof parsed.quote === "string" ? parsed.quote.trim() : "",
  };
}

/** Counts browser actions against the scenario's hard step limit. */
export function createStepBudget(maxSteps: number) {
  let used = 0;
  let blocked = 0;

  return {
    tryConsume() {
      if (used >= maxSteps) {
        blocked += 1;
        return false;
      }

      used += 1;
      return true;
    },
    get used() {
      return used;
    },
    get blocked() {
      return blocked;
    },
    get exhausted() {
      return used >= maxSteps;
    },
  };
}

export type StepBudget = ReturnType<typeof createStepBudget>;
