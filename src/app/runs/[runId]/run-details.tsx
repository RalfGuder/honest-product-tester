"use client";

import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock3,
  CircleCheckBig,
  SkipForward,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { REPORT_INSIGHT_DEFINITIONS } from "@/lib/report-insights";
import type { CellRunRecord, RunManifest } from "@/lib/runs";
import { EXPLORE_SCENARIO, EXPLORE_SCENARIO_ID } from "@/lib/scenario-model";
import type { CellReport, Verdict } from "@/lib/scenario-verdict";
import styles from "./page.module.css";

type RunPayload = {
  manifest: RunManifest;
  cells: CellRunRecord[];
};

type RunDetailsProps = {
  initialRun: RunPayload;
};

const statusIcons = {
  queued: Clock3,
  running: CircleDashed,
  completed: CircleCheckBig,
  failed: AlertCircle,
  skipped: SkipForward,
} as const;

const VERDICT_DISPLAY: Record<Verdict, { icon: string; label: string }> = {
  passed: { icon: "✅", label: "Passed" },
  failed: { icon: "❌", label: "Failed" },
  gave_up: { icon: "🏳️", label: "Gave up" },
  limit_reached: { icon: "⏱️", label: "Limit reached" },
  error: { icon: "⚠️", label: "Error" },
  skipped: { icon: "⏭️", label: "Skipped" },
};

const FINISHED_STATUSES: CellRunRecord["status"][] = ["completed", "failed", "skipped"];

export function RunDetails({ initialRun }: RunDetailsProps) {
  const [run, setRun] = useState(initialRun);
  const scenarios = run.manifest.scenarios?.length
    ? run.manifest.scenarios
    : [EXPLORE_SCENARIO];
  const [selectedScenarioId, setSelectedScenarioId] = useState(scenarios[0].id);
  const terminalRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const runningCount = run.cells.filter((cell) => cell.status === "running").length;
  const finishedCount = run.cells.filter((cell) => FINISHED_STATUSES.includes(cell.status)).length;
  const personaIds = [...new Set(run.cells.map((cell) => cell.personaId))];
  const visibleCells = run.cells.filter((cell) => cell.scenarioId === selectedScenarioId);
  // A plain free-exploration run looks like it always did: no matrix, just the persona cards.
  const showMatrix = scenarios.length > 1 || scenarios[0].id !== EXPLORE_SCENARIO_ID;

  useEffect(() => {
    if (run.manifest.status === "completed" || run.manifest.status === "failed") {
      return;
    }

    let stopped = false;

    const poll = async () => {
      try {
        const response = await fetch(`/api/runs/${run.manifest.id}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const nextRun = (await response.json()) as RunPayload;

        if (!stopped) {
          setRun(nextRun);
        }
      } catch {
        return;
      }
    };

    poll();
    const interval = window.setInterval(poll, 2000);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [run.manifest.id, run.manifest.status]);

  useEffect(() => {
    for (const cell of run.cells) {
      const terminal = terminalRefs.current[cell.cellId];

      if (terminal) {
        terminal.scrollTop = terminal.scrollHeight;
      }
    }
  }, [run, selectedScenarioId]);

  const statusCopy = useMemo(() => {
    if (run.manifest.status === "running") {
      return `Running ${runningCount} of ${run.cells.length} test runs`;
    }

    return run.manifest.status;
  }, [run.manifest.status, run.cells.length, runningCount]);

  const fakeProgress = useMemo(() => {
    if (run.manifest.status !== "running") {
      return run.manifest.status === "completed" ? 100 : 0;
    }

    const completionProgress = (finishedCount / run.cells.length) * 100;

    return Math.max(8, Math.min(94, Math.round(completionProgress)));
  }, [finishedCount, run.manifest.status, run.cells.length]);

  return (
    <>
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <Link href="/" className={styles.backLink}>
            Back
          </Link>
          <div className={styles.runMeta}>
            <span className={styles.runUrl}>{`UX Testing ${run.manifest.url}`}</span>
          </div>
        </div>
        <div className={styles.topBarRight}>
          {run.manifest.status === "running" ? (
            <div
              className={styles.progressStatus}
              aria-label={`Run progress ${fakeProgress}%`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={fakeProgress}
            >
              <span className={styles.progressLabel}>Progress</span>
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${fakeProgress}%` }}
                />
              </div>
              <span className={styles.progressValue}>{fakeProgress}%</span>
            </div>
          ) : (
            <span className={styles.status}>{statusCopy}</span>
          )}
        </div>
      </div>

      {showMatrix ? (
        <div className={styles.matrixWrap}>
          <table className={styles.matrix}>
            <thead>
              <tr>
                <th scope="col">Tester</th>
                {scenarios.map((scenario) => (
                  <th
                    key={scenario.id}
                    scope="col"
                    data-selected={scenario.id === selectedScenarioId}
                  >
                    <button type="button" onClick={() => setSelectedScenarioId(scenario.id)}>
                      {scenario.title}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {personaIds.map((personaId) => {
                const personaCells = run.cells.filter((cell) => cell.personaId === personaId);

                return (
                  <tr key={personaId}>
                    <th scope="row">{personaCells[0]?.personaName ?? personaId}</th>
                    {scenarios.map((scenario) => {
                      const cell = personaCells.find((item) => item.scenarioId === scenario.id);

                      return (
                        <td key={scenario.id} data-selected={scenario.id === selectedScenarioId}>
                          {cell ? (
                            <button
                              type="button"
                              className={styles.matrixCell}
                              data-verdict={cell.cellReport?.verdict}
                              onClick={() => setSelectedScenarioId(scenario.id)}
                              title={cell.summary}
                            >
                              <MatrixCellContent cell={cell} />
                            </button>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Passed</th>
                {scenarios.map((scenario) => (
                  <td key={scenario.id} data-selected={scenario.id === selectedScenarioId}>
                    {scenario.id === EXPLORE_SCENARIO_ID
                      ? "–"
                      : formatPassRate(
                          run.cells.filter((cell) => cell.scenarioId === scenario.id),
                        )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      <section className={styles.section}>
        <div className={styles.personaGrid}>
          {visibleCells.map((cell) => {
            const finished = FINISHED_STATUSES.includes(cell.status);
            const isExplore = cell.scenarioId === EXPLORE_SCENARIO_ID;

            return (
              <article key={cell.cellId} className={styles.personaCard} data-status={cell.status}>
                <div className={styles.panelScroll}>
                  <div className={styles.panelHeader}>
                    <div className={styles.avatarWrap}>
                      <Image
                        src={cell.personaAvatar}
                        alt={cell.personaName}
                        width={52}
                        height={52}
                        className={styles.avatar}
                      />
                    </div>
                    <div className={styles.panelMeta}>
                      <h3>{cell.personaName}</h3>
                      <StatusBadge status={cell.status} />
                    </div>
                  </div>
                  <div className={styles.panelBody}>
                    {finished && isExplore ? <StructuredSummary personaRun={cell} /> : null}
                    {finished && cell.cellReport ? (
                      <CellReportView report={cell.cellReport} />
                    ) : null}

                    {!finished || !isExplore ? (
                      <>
                        <div className={styles.screenFrame}>
                          {cell.latestScreenshotFileName ? (
                            <Image
                              src={`/api/runs/${run.manifest.id}/screenshots/${cell.latestScreenshotFileName}?v=${cell.latestScreenshotTakenAt ?? cell.updatedAt ?? ""}`}
                              alt={`${cell.personaName} live browser screenshot`}
                              fill
                              sizes="(max-width: 680px) 100vw, (max-width: 900px) 50vw, 33vw"
                              className={styles.screenImage}
                              unoptimized
                            />
                          ) : (
                            <div className={styles.screenPlaceholder}>
                              <span className={styles.placeholderLabel}>
                                {cell.status === "queued" ? "Booting persona" : "No screenshot yet"}
                              </span>
                              <p>{cell.summary}</p>
                            </div>
                          )}
                        </div>

                        <div className={styles.subsection}>
                          <h4>{finished ? "Timeline" : "Live terminal"}</h4>
                          <div
                            ref={(node) => {
                              terminalRefs.current[cell.cellId] = node;
                            }}
                            className={styles.terminal}
                          >
                            {buildTerminalLines(cell).map((line, index) => (
                              <div
                                key={`${cell.cellId}-terminal-${index}-${line.label}`}
                                className={styles.terminalLine}
                                data-tone={line.tone}
                              >
                                <span className={styles.terminalTime}>{line.time}</span>
                                <span className={styles.terminalPrompt}>{line.prompt}</span>
                                <span className={styles.terminalText}>{line.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : null}

                    {cell.error ? <div className={styles.errorBox}>{cell.error}</div> : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

function MatrixCellContent({ cell }: { cell: CellRunRecord }) {
  if (cell.cellReport) {
    const display = VERDICT_DISPLAY[cell.cellReport.verdict];

    return (
      <>
        <span aria-hidden="true">{display.icon}</span>
        <span>{display.label}</span>
        {cell.cellReport.verdict !== "skipped" ? (
          <span className={styles.matrixSteps}>
            {cell.cellReport.stepsUsed}/{cell.cellReport.maxSteps}
          </span>
        ) : null}
      </>
    );
  }

  const StatusIcon = statusIcons[cell.status];

  return (
    <>
      <StatusIcon size={15} strokeWidth={2.2} aria-hidden="true" />
      <span>{cell.status}</span>
    </>
  );
}

function formatPassRate(cells: CellRunRecord[]) {
  const judged = cells.filter(
    (cell) => cell.cellReport && cell.cellReport.verdict !== "skipped",
  );
  const passed = judged.filter((cell) => cell.cellReport?.verdict === "passed").length;

  return judged.length === 0 ? "–" : `${passed} / ${judged.length}`;
}

function CellReportView({ report }: { report: CellReport }) {
  const display = VERDICT_DISPLAY[report.verdict];

  return (
    <div className={styles.reportBlock}>
      <div className={styles.verdictLine} data-verdict={report.verdict}>
        <span aria-hidden="true">{display.icon}</span>
        <strong>{display.label}</strong>
        <span className={styles.matrixSteps}>
          {report.stepsUsed} / {report.maxSteps} steps
        </span>
      </div>
      {report.misjudged ? (
        <p className={styles.misjudged}>
          Persona misjudged: they reported &quot;{report.selfVerdict}&quot;, the assertions say
          otherwise.
        </p>
      ) : null}
      {report.quote ? <blockquote className={styles.personaQuote}>{report.quote}</blockquote> : null}
      {report.note ? <p className={styles.reportNote}>{report.note}</p> : null}
      {report.frictionPoints.length > 0 ? (
        <section className={styles.insightCard}>
          <h4 className={styles.insightTitle}>Friction points</h4>
          <ul className={styles.frictionList}>
            {report.frictionPoints.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {report.evidence.finalUrl || report.evidence.quote ? (
        <section className={styles.insightCard}>
          <h4 className={styles.insightTitle}>Evidence</h4>
          {report.evidence.finalUrl ? (
            <p className={styles.evidenceUrl}>{report.evidence.finalUrl}</p>
          ) : null}
          {report.evidence.quote ? (
            <p className={styles.insightAnswer}>&ldquo;{report.evidence.quote}&rdquo;</p>
          ) : null}
        </section>
      ) : null}
      {report.assertionResults.length > 0 ? (
        <section className={styles.insightCard}>
          <h4 className={styles.insightTitle}>Assertions</h4>
          <ul className={styles.frictionList}>
            {report.assertionResults.map((result) => (
              <li key={`${result.type}-${result.value}`} title={result.detail}>
                {result.passed ? "✅" : "❌"}{" "}
                {result.type === "url_contains" ? "URL contains" : "Shows text"} &quot;
                {result.value}&quot;
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: CellRunRecord["status"] }) {
  const StatusIcon = statusIcons[status];

  return (
    <span className={styles.queueBadge} aria-label={status} title={status}>
      <StatusIcon size={18} strokeWidth={2.2} />
    </span>
  );
}

type TerminalLine = {
  label: string;
  prompt: "$" | ">" | "*";
  time: string;
  tone: "neutral" | "success" | "error";
};

function buildTerminalLines(personaRun: CellRunRecord): TerminalLine[] {
  const lines: TerminalLine[] = [];

  lines.push({
    time: formatTerminalTime(personaRun.startedAt ?? personaRun.updatedAt),
    prompt: "$",
    label: `persona booted (${personaRun.status})`,
    tone: "neutral",
  });

  lines.push({
    time: formatTerminalTime(personaRun.updatedAt),
    prompt: ">",
    label: personaRun.summary,
    tone: personaRun.status === "failed" ? "error" : "neutral",
  });

  for (const action of [...personaRun.actions].reverse()) {
    lines.push({
      time: formatTerminalTime(action.at),
      prompt: "$",
      label: `${action.tool} ${summarizeActionInput(action.input)}`,
      tone: action.outcome === "error" ? "error" : "success",
    });
  }

  for (const observation of [...personaRun.observations.slice(0, 4)].reverse()) {
    lines.push({
      time: formatTerminalTime(personaRun.updatedAt),
      prompt: "*",
      label: summarizeObservation(observation),
      tone: "neutral",
    });
  }

  if (personaRun.error) {
    lines.push({
      time: formatTerminalTime(personaRun.updatedAt),
      prompt: ">",
      label: personaRun.error,
      tone: "error",
    });
  }

  return lines;
}

function summarizeActionInput(input: string) {
  const compact = input
    .replace(/\/Users\/[^ ]+/g, "[file]")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= 56) {
    return compact;
  }

  return `${compact.slice(0, 53)}...`;
}

function summarizeObservation(observation: string) {
  const firstLine = observation.split("\n")[0]?.trim() ?? observation.trim();

  if (firstLine.length <= 68) {
    return firstLine;
  }

  return `${firstLine.slice(0, 65)}...`;
}

function formatTerminalTime(timestamp?: string) {
  if (!timestamp) {
    return "--:--:--";
  }

  return timestamp.slice(11, 19);
}

function StructuredSummary({ personaRun }: { personaRun: CellRunRecord }) {
  const [showAllInsights, setShowAllInsights] = useState(false);
  const ExpandIcon = showAllInsights ? ChevronUp : ChevronDown;

  if (!personaRun.structuredSummary?.length) {
    return (
      <div className={styles.reportBlock}>
        <p className={styles.emptySummary}>
          No structured summary was captured for this persona.
        </p>
      </div>
    );
  }

  const visibleInsightIds = showAllInsights
    ? REPORT_INSIGHT_DEFINITIONS.map((definition) => definition.id)
    : ["unexpectedElements", "magicWandFix"];
  const visibleInsights = REPORT_INSIGHT_DEFINITIONS.filter((definition) =>
    visibleInsightIds.includes(definition.id),
  );

  return (
    <div className={styles.reportBlock}>
      <div className={styles.insightList}>
        {visibleInsights.map((definition) => {
          const answer =
            personaRun.structuredSummary?.find((item) => item.id === definition.id)
              ?.answer ?? "Missing answer.";

          return (
            <section key={definition.id} className={styles.insightCard}>
              <div className={styles.insightHeader}>
                <div className={styles.insightTitleWrap}>
                  <div className={styles.tooltipWrap}>
                    <h4 className={styles.insightTitle} tabIndex={0}>
                      {definition.title}
                    </h4>
                    <span className={styles.tooltip}>{definition.info}</span>
                  </div>
                </div>
              </div>
              <p className={styles.insightAnswer}>{answer}</p>
            </section>
          );
        })}
      </div>
      <button
        type="button"
        className={styles.expandInsightsButton}
        onClick={() => {
          setShowAllInsights((current) => !current);
        }}
      >
        <ExpandIcon size={15} strokeWidth={2.6} />
        {showAllInsights ? "Show fewer" : "Show all 4"}
      </button>
    </div>
  );
}
