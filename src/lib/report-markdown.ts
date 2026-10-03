import type { Dictionary } from "@/i18n/dictionaries/en";
import { format } from "@/i18n/format";
import { renderLiveText } from "@/i18n/live";
import {
  REPORT_INSIGHT_DEFINITIONS,
  type PersonaReportInsight,
} from "@/lib/report-insights";
import type { CellReport } from "@/lib/scenario-verdict";

// Markdown reports written to data/runs/<run>/cells/, in the run's report language.

export function buildCellReportMarkdown(
  t: Dictionary,
  title: string,
  successCriteria: string,
  report: CellReport,
) {
  const labels = t.reportFile;
  const verdict = t.verdicts[report.verdict];
  const selfVerdict =
    report.misjudged && report.selfVerdict
      ? ` (${format(labels.personaSaid, { verdict: t.verdicts[report.selfVerdict] })})`
      : "";
  const lines = [
    `# ${title}`,
    "",
    `- **${labels.verdict}:** ${verdict}${selfVerdict}`,
    `- **${labels.steps}:** ${report.stepsUsed} / ${report.maxSteps}`,
    `- **${labels.successCriteria}:** ${successCriteria}`,
  ];

  if (report.quote) {
    lines.push(`- **${labels.quote}:** "${report.quote}"`);
  }

  if (report.evidence.finalUrl || report.evidence.quote) {
    const evidence = [report.evidence.finalUrl, report.evidence.quote && `"${report.evidence.quote}"`]
      .filter(Boolean)
      .join(" – ");

    lines.push(`- **${labels.evidence}:** ${evidence}`);
  }

  const note = report.noteMessage ? renderLiveText(report.noteMessage, t) : report.note;

  if (note) {
    lines.push(`- **${labels.note}:** ${note}`);
  }

  if (report.frictionPoints.length > 0) {
    lines.push("", `## ${labels.frictionPoints}`, "", ...report.frictionPoints.map((item) => `- ${item}`));
  }

  if (report.assertionResults.length > 0) {
    lines.push(
      "",
      `## ${labels.assertions}`,
      "",
      ...report.assertionResults.map(
        (result) =>
          `- ${result.passed ? "✅" : "❌"} ${t.scenarioForm.assertionTypes[result.type]}: ${result.value}`,
      ),
    );
  }

  return `${lines.join("\n")}\n`;
}

export function buildSummaryMarkdown(
  t: Dictionary,
  personaName: string,
  insights: PersonaReportInsight[],
) {
  const bullets = REPORT_INSIGHT_DEFINITIONS.flatMap(({ id }) => {
    const insight = insights.find((item) => item.id === id);

    return insight ? [`- **${t.insights[id].title}:** ${insight.answer}`] : [];
  }).join("\n");

  return `# ${personaName}\n\n${bullets}\n`;
}

export function buildFailedReportMarkdown(t: Dictionary, title: string, message: string) {
  return `# ${title}\n\n${t.reportFile.runFailed}\n\n${message}\n`;
}

export function buildQueuedReportMarkdown(t: Dictionary, title: string) {
  return `# ${title}\n\n${t.reportFile.statusQueued}\n\n${t.reportFile.queuedInfo}\n`;
}
