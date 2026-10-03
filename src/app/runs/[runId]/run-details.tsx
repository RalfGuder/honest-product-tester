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

import { LOCALE_NAMES } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { renderLiveText } from "@/i18n/live";
import { useI18n } from "@/i18n/provider";
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

const VERDICT_ICONS: Record<Verdict, string> = {
  passed: "✅",
  failed: "❌",
  gave_up: "🏳️",
  limit_reached: "⏱️",
  error: "⚠️",
  skipped: "⏭️",
};

const FINISHED_STATUSES: CellRunRecord["status"][] = ["completed", "failed", "skipped"];

export function RunDetails({ initialRun }: RunDetailsProps) {
  const [run, setRun] = useState(initialRun);
  const { t, format } = useI18n();
  const scenarios = run.manifest.scenarios?.length
    ? run.manifest.scenarios
    : [EXPLORE_SCENARIO];
  const [selectedScenarioId, setSelectedScenarioId] = useState(scenarios[0].id);
  // Finished cells hide the screenshot and timeline; these cells have them opened again.
  const [openDetails, setOpenDetails] = useState<Set<string>>(() => new Set());
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

  const statusCopy =
    run.manifest.status === "running"
      ? format(t.run.running, { running: runningCount, total: run.cells.length })
      : t.run.status[run.manifest.status];
  const scenarioTitle = (scenario: { id: string; title: string }) =>
    scenario.id === EXPLORE_SCENARIO_ID ? t.scenarios.explore : scenario.title;

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
            {t.common.back}
          </Link>
          <div className={styles.runMeta}>
            <span className={styles.runUrl}>{format(t.run.uxTesting, { url: run.manifest.url })}</span>
            {run.manifest.reportLanguage ? (
              <span className={styles.runFacts}>
                {format(t.run.reportLanguage, {
                  language: LOCALE_NAMES[run.manifest.reportLanguage],
                })}
              </span>
            ) : null}
          </div>
        </div>
        <div className={styles.topBarRight}>
          {run.manifest.status === "running" ? (
            <div
              className={styles.progressStatus}
              aria-label={format(t.run.progressLabel, { value: fakeProgress })}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={fakeProgress}
            >
              <span className={styles.progressLabel}>{t.run.progress}</span>
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
                <th scope="col">{t.run.tester}</th>
                {scenarios.map((scenario) => (
                  <th
                    key={scenario.id}
                    scope="col"
                    data-selected={scenario.id === selectedScenarioId}
                  >
                    <button type="button" onClick={() => setSelectedScenarioId(scenario.id)}>
                      {scenarioTitle(scenario)}
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
                              title={renderLiveText(cell.summary, t)}
                            >
                              <MatrixCellContent cell={cell} />
                            </button>
                          ) : (
                            <span className={styles.notAssigned} title={t.run.notAssigned}>
                              –
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t.run.passed}</th>
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
            const showLive = !finished || openDetails.has(cell.cellId);
            const DetailsIcon = openDetails.has(cell.cellId) ? ChevronUp : ChevronDown;

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

                    {finished ? (
                      <button
                        type="button"
                        className={styles.expandInsightsButton}
                        onClick={() =>
                          setOpenDetails((current) => {
                            const next = new Set(current);

                            if (next.has(cell.cellId)) {
                              next.delete(cell.cellId);
                            } else {
                              next.add(cell.cellId);
                            }

                            return next;
                          })
                        }
                      >
                        <DetailsIcon size={15} strokeWidth={2.6} />
                        {openDetails.has(cell.cellId) ? t.run.hideDetails : t.run.showDetails}
                      </button>
                    ) : null}

                    {showLive ? (
                      <>
                        <div className={styles.screenFrame}>
                          {cell.latestScreenshotFileName ? (
                            <Image
                              src={`/api/runs/${run.manifest.id}/screenshots/${cell.latestScreenshotFileName}?v=${cell.latestScreenshotTakenAt ?? cell.updatedAt ?? ""}`}
                              alt={format(t.run.screenshotAlt, { name: cell.personaName })}
                              fill
                              sizes="(max-width: 680px) 100vw, (max-width: 900px) 50vw, 33vw"
                              className={styles.screenImage}
                              unoptimized
                            />
                          ) : (
                            <div className={styles.screenPlaceholder}>
                              <span className={styles.placeholderLabel}>
                                {cell.status === "queued" ? t.run.bootingPersona : t.run.noScreenshot}
                              </span>
                              <p>{renderLiveText(cell.summary, t)}</p>
                            </div>
                          )}
                        </div>

                        <div className={styles.subsection}>
                          <h4>{finished ? t.run.timeline : t.run.liveTerminal}</h4>
                          <div
                            ref={(node) => {
                              terminalRefs.current[cell.cellId] = node;
                            }}
                            className={styles.terminal}
                          >
                            {buildTerminalLines(
                              cell,
                              t,
                              format(t.run.personaBooted, { status: t.cellStatus[cell.status] }),
                            ).map((line, index) => (
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
  const { t } = useI18n();

  if (cell.cellReport) {
    const { verdict } = cell.cellReport;

    return (
      <>
        <span aria-hidden="true">{VERDICT_ICONS[verdict]}</span>
        <span>{t.verdicts[verdict]}</span>
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
      <span>{t.cellStatus[cell.status]}</span>
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
  const { t, format } = useI18n();

  return (
    <div className={styles.reportBlock}>
      <div className={styles.verdictLine} data-verdict={report.verdict}>
        <span aria-hidden="true">{VERDICT_ICONS[report.verdict]}</span>
        <strong>{t.verdicts[report.verdict]}</strong>
        <span className={styles.matrixSteps}>
          {format(t.run.steps, { used: report.stepsUsed, max: report.maxSteps })}
        </span>
      </div>
      {report.misjudged ? (
        <p className={styles.misjudged}>
          {format(t.run.misjudged, {
            verdict: report.selfVerdict ? t.verdicts[report.selfVerdict] : "",
          })}
        </p>
      ) : null}
      {report.quote ? <blockquote className={styles.personaQuote}>{report.quote}</blockquote> : null}
      {report.noteMessage || report.note ? (
        <p className={styles.reportNote}>
          {report.noteMessage ? renderLiveText(report.noteMessage, t) : report.note}
        </p>
      ) : null}
      {report.frictionPoints.length > 0 ? (
        <section className={styles.insightCard}>
          <h4 className={styles.insightTitle}>{t.run.frictionPoints}</h4>
          <ul className={styles.frictionList}>
            {report.frictionPoints.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {report.evidence.finalUrl || report.evidence.quote ? (
        <section className={styles.insightCard}>
          <h4 className={styles.insightTitle}>{t.run.evidence}</h4>
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
          <h4 className={styles.insightTitle}>{t.run.assertions}</h4>
          <ul className={styles.frictionList}>
            {report.assertionResults.map((result) => (
              <li key={`${result.type}-${result.value}`} title={result.detail}>
                {result.passed ? "✅" : "❌"}{" "}
                {result.type === "url_contains" ? t.run.urlContains : t.run.showsText} &quot;
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
  const { t } = useI18n();
  const StatusIcon = statusIcons[status];

  return (
    <span
      className={styles.queueBadge}
      aria-label={t.cellStatus[status]}
      title={t.cellStatus[status]}
    >
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

function buildTerminalLines(
  personaRun: CellRunRecord,
  t: Dictionary,
  bootedLabel: string,
): TerminalLine[] {
  const lines: TerminalLine[] = [];

  lines.push({
    time: formatTerminalTime(personaRun.startedAt ?? personaRun.updatedAt),
    prompt: "$",
    label: bootedLabel,
    tone: "neutral",
  });

  lines.push({
    time: formatTerminalTime(personaRun.updatedAt),
    prompt: ">",
    label: renderLiveText(personaRun.summary, t),
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
      label: summarizeObservation(renderLiveText(observation, t)),
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
  const { t } = useI18n();
  const ExpandIcon = showAllInsights ? ChevronUp : ChevronDown;

  if (!personaRun.structuredSummary?.length) {
    return (
      <div className={styles.reportBlock}>
        <p className={styles.emptySummary}>{t.run.noSummary}</p>
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
              ?.answer ?? t.run.missingAnswer;

          return (
            <section key={definition.id} className={styles.insightCard}>
              <div className={styles.insightHeader}>
                <div className={styles.insightTitleWrap}>
                  <div className={styles.tooltipWrap}>
                    <h4 className={styles.insightTitle} tabIndex={0}>
                      {t.insights[definition.id].title}
                    </h4>
                    <span className={styles.tooltip}>{t.insights[definition.id].info}</span>
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
        {showAllInsights ? t.run.showFewer : t.run.showAll}
      </button>
    </div>
  );
}
