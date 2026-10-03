import { describe, expect, it } from "vitest";

import { de } from "@/i18n/dictionaries/de";
import { en } from "@/i18n/dictionaries/en";
import {
  buildCellReportMarkdown,
  buildFailedReportMarkdown,
  buildQueuedReportMarkdown,
  buildSummaryMarkdown,
} from "@/lib/report-markdown";
import type { CellReport } from "@/lib/scenario-verdict";

const report: CellReport = {
  verdict: "failed",
  selfVerdict: "passed",
  misjudged: true,
  evidence: { finalUrl: "https://x.test/dm", quote: "Gesendet" },
  stepsUsed: 17,
  maxSteps: 60,
  frictionPoints: ["Der Button reagierte nicht"],
  quote: "Läuft.",
  assertionResults: [{ type: "url_contains", value: "/dm", passed: false }],
  note: "Step budget of 60 browser actions was used up.",
  noteMessage: { key: "stepBudgetUsed", params: { steps: 60 } },
};

describe("buildCellReportMarkdown", () => {
  it("writes every label in the report language", () => {
    const markdown = buildCellReportMarkdown(de, "Tom – Checkout", "Bestellung sichtbar", report);

    expect(markdown).toBe(
      [
        "# Tom – Checkout",
        "",
        "- **Ergebnis:** Nicht geschafft (Persona meldete: Bestanden)",
        "- **Schritte:** 17 / 60",
        "- **Erfolgskriterium:** Bestellung sichtbar",
        '- **Zitat:** "Läuft."',
        '- **Beleg:** https://x.test/dm – "Gesendet"',
        "- **Hinweis:** Das Schrittbudget von 60 Browser-Aktionen ist aufgebraucht.",
        "",
        "## Reibungspunkte",
        "",
        "- Der Button reagierte nicht",
        "",
        "## Assertions",
        "",
        "- ❌ End-URL enthält: /dm",
        "",
      ].join("\n"),
    );
  });

  it("keeps English for English runs", () => {
    const markdown = buildCellReportMarkdown(en, "T", "C", report);

    expect(markdown).toContain("- **Verdict:** Failed (persona said: Passed)");
    expect(markdown).toContain("- **Note:** Step budget of 60 browser actions was used up.");
  });

  it("falls back to the stored English note without a translatable message", () => {
    const markdown = buildCellReportMarkdown(de, "T", "C", { ...report, noteMessage: undefined });

    expect(markdown).toContain("- **Hinweis:** Step budget of 60 browser actions was used up.");
  });
});

describe("buildSummaryMarkdown", () => {
  it("uses the translated insight titles", () => {
    expect(buildSummaryMarkdown(de, "Tom", [{ id: "magicWandFix", answer: "Mehr Farbe" }])).toBe(
      "# Tom\n\n- **Der „Zauberstab“-Fix:** Mehr Farbe\n",
    );
  });
});

describe("status reports", () => {
  it("translates the failed and queued placeholders", () => {
    expect(buildFailedReportMarkdown(de, "Tom", "boom")).toBe(
      "# Tom\n\nLauf fehlgeschlagen.\n\nboom\n",
    );
    expect(buildQueuedReportMarkdown(de, "Tom")).toContain("Status: wartet");
  });
});
