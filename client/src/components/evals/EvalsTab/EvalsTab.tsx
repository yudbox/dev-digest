/* EvalsTab — ONE component mounted in both AgentEditor and SkillEditor
   (AC-23). Renders: aggregated metric tiles, case list (name, last-run
   pass/fail, recall%), "New case" button. Agent-only: "View full dashboard"
   link. Skill-only: no trend/history/Compare/Promote/dashboard-link, but
   each case row additionally shows with/without-skill numbers (AC-28). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Button,
  Skeleton,
  EmptyState,
  MetricCard,
  Badge,
  Icon,
} from "@devdigest/ui";
import type { EvalCase, EvalOwnerKind, SkillType } from "@devdigest/shared";
import {
  useEvalCases,
  useEvalDashboard,
  useDeleteEvalCase,
  useRunEvalCase,
  useRunAgentEvals,
  useRunSkillEvals,
} from "@/lib/hooks/evals";
import { EvalCaseModal } from "@/components/evals/EvalCaseModal/EvalCaseModal";
import { lastRunForCase, parseWithWithout } from "./helpers";
import { notify } from "@/lib/contexts/toast";

export function EvalsTab({
  ownerKind,
  ownerId,
  skillType,
}: {
  ownerKind: EvalOwnerKind;
  ownerId: string;
  /** Set only for `ownerKind === "skill"`; drives the rubric-vs-finding-
   *  grounded UI branches downstream (metric tiles, case-row badge, and the
   *  Code/PR-meta tab split in `EvalCaseModal`). Agents never pass this. */
  skillType?: SkillType;
}) {
  const t = useTranslations("eval.evalsTab");
  const td = useTranslations("eval.dashboard");

  const { data: cases, isLoading: casesLoading } = useEvalCases(
    ownerKind,
    ownerId,
  );
  const { data: dashboard } = useEvalDashboard(ownerKind, ownerId);
  const deleteCase = useDeleteEvalCase();
  const runCase = useRunEvalCase();
  const runAll = useRunAgentEvals(ownerKind === "agent" ? ownerId : null);
  const runAllSkill = useRunSkillEvals(ownerKind === "skill" ? ownerId : null);

  const [runningIds, setRunningIds] = React.useState<Set<string>>(new Set());

  const [modalState, setModalState] = React.useState<
    { mode: "new" } | { mode: "edit"; evalCase: EvalCase } | null
  >(null);

  const recentRuns = dashboard?.recent_runs ?? [];
  const isSkill = ownerKind === "skill";
  const isRubric = isSkill && skillType === "rubric";

  // delta helpers
  const fmtDelta = (d: number) => {
    const pts = Math.round(Math.abs(d) * 100);
    if (pts === 0) return null;
    return { pts, up: d >= 0 };
  };

  const passingCount =
    cases?.filter((c) => {
      const last = lastRunForCase(recentRuns, c.id);
      return last?.pass === true;
    }).length ?? 0;

  return (
    <div
      style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}
    >
      {modalState && (
        <EvalCaseModal
          ownerKind={ownerKind}
          ownerId={ownerId}
          skillType={skillType}
          initial={modalState.mode === "edit" ? modalState.evalCase : null}
          lastRun={
            modalState.mode === "edit"
              ? lastRunForCase(recentRuns, modalState.evalCase.id)
              : null
          }
          onClose={() => setModalState(null)}
        />
      )}

      {/* Aggregated metric tiles — agents only; skills do not collect
          aggregate run statistics so this section is hidden for them. */}
      {!isSkill && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 4,
            }}
          >
            <h2
              style={{
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
                textTransform: "uppercase",
              }}
            >
              {t("metricsTitle")}
            </h2>
            {!isSkill && (
              <Link
                href={`/eval/${ownerId}`}
                style={{
                  fontSize: 13,
                  color: "var(--accent)",
                  textDecoration: "none",
                }}
              >
                {t("viewDashboard")}
              </Link>
            )}
          </div>

          {dashboard ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isRubric
                    ? "1fr 1fr 1fr"
                    : "1fr 1fr 1fr 1fr",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                {/* RECALL */}
                {(() => {
                  const d = fmtDelta(dashboard.delta.recall);
                  return (
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--bg-elevated)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: "0.07em",
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          marginBottom: 4,
                        }}
                      >
                        {td("metrics.recall")}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 22,
                            fontWeight: 700,
                            color: "var(--accent)",
                          }}
                        >
                          {Math.round(dashboard.current.recall * 100)}%
                        </span>
                        {d && (
                          <span
                            style={{
                              fontSize: 11,
                              color: d.up ? "var(--ok)" : "var(--crit)",
                            }}
                          >
                            {d.up ? "▲" : "▼"}
                            {d.pts}pt
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
                {/* PRECISION */}
                {(() => {
                  const d = fmtDelta(dashboard.delta.precision);
                  return (
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--bg-elevated)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: "0.07em",
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          marginBottom: 4,
                        }}
                      >
                        {td("metrics.precision")}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 22,
                            fontWeight: 700,
                            color: "var(--warn)",
                          }}
                        >
                          {Math.round(dashboard.current.precision * 100)}%
                        </span>
                        {d && (
                          <span
                            style={{
                              fontSize: 11,
                              color: d.up ? "var(--ok)" : "var(--crit)",
                            }}
                          >
                            {d.up ? "▲" : "▼"}
                            {d.pts}pt
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
                {/* CITATION ACCURACY — omitted for rubric skills: the
                  single-call rubric strategy never populates it (no
                  finding-grounding step to measure). */}
                {!isRubric &&
                  (() => {
                    const d = fmtDelta(dashboard.delta.citation_accuracy);
                    return (
                      <div
                        style={{
                          padding: "12px 14px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--bg-elevated)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: "0.07em",
                            color: "var(--text-muted)",
                            textTransform: "uppercase",
                            marginBottom: 4,
                          }}
                        >
                          {td("metrics.citationAccuracy")}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "baseline",
                            gap: 8,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 22,
                              fontWeight: 700,
                              color: "#f97316",
                            }}
                          >
                            {Math.round(
                              dashboard.current.citation_accuracy * 100,
                            )}
                            %
                          </span>
                          {d && (
                            <span
                              style={{
                                fontSize: 11,
                                color: d.up ? "var(--ok)" : "var(--crit)",
                              }}
                            >
                              {d.up ? "▲" : "▼"}
                              {d.pts}pt
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                {/* TRACES PASSED */}
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg-elevated)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.07em",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    {t("tracesPassed")}
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "var(--text-primary)",
                    }}
                  >
                    {dashboard.current.traces_passed}/
                    {dashboard.current.traces_total}
                  </div>
                </div>
              </div>
              <p
                style={{
                  fontSize: 11.5,
                  color: "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icon.Code size={12} />
                {t("scoringHint")}
              </p>
            </>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isRubric
                  ? "1fr 1fr 1fr"
                  : "1fr 1fr 1fr 1fr",
                gap: 10,
              }}
            >
              <Skeleton height={72} />
              <Skeleton height={72} />
              <Skeleton height={72} />
              {!isRubric && <Skeleton height={72} />}
            </div>
          )}
        </div>
      )}

      {/* Case list */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>
              {t("casesHeading")}
            </h2>
            {cases && cases.length > 0 && (
              <>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 7px",
                    borderRadius: 10,
                    background:
                      "color-mix(in srgb, var(--ok) 15%, transparent)",
                    color: "var(--ok)",
                  }}
                >
                  {passingCount}/{cases.length} passing
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {cases.length} cases
                </span>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {!isSkill && cases && cases.length > 0 && (
              <Button
                kind="secondary"
                size="sm"
                icon="Play"
                loading={runAll.isPending}
                onClick={() => runAll.mutate()}
              >
                {runAll.isPending ? t("running") : t("runAll")}
              </Button>
            )}
            {isSkill && cases && cases.length > 0 && (
              <Button
                kind="secondary"
                size="sm"
                icon="Play"
                loading={runAllSkill.isPending}
                onClick={() => runAllSkill.mutate()}
              >
                {runAllSkill.isPending ? t("running") : t("runAll")}
              </Button>
            )}
            <Button
              kind="primary"
              size="sm"
              icon="Plus"
              onClick={() => setModalState({ mode: "new" })}
            >
              {t("newCase")}
            </Button>
          </div>
        </div>

        {casesLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={56} />
            <Skeleton height={56} />
          </div>
        ) : !cases || cases.length === 0 ? (
          <EmptyState icon="FlaskConical" title={t("emptyCases")} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {cases.map((c) => {
              const last = lastRunForCase(recentRuns, c.id);
              const withWithout = isSkill
                ? parseWithWithout(last?.actual_output)
                : null;
              const isMustFind = (c.expected_output as unknown[]).length > 0;
              const expectedCount = (c.expected_output as unknown[]).length;
              const actualCount = last
                ? ((last.actual_output as unknown[]) ?? []).length
                : null;
              const firstExp = isMustFind
                ? (
                    c.expected_output as Array<{
                      severity?: string;
                      category?: string;
                    }>
                  )[0]
                : null;
              const sevLabel = !isRubric ? (firstExp?.severity ?? null) : null;
              const catLabel = !isRubric ? (firstExp?.category ?? null) : null;
              const dimensionLabel = isRubric
                ? ((c.expected_output as Array<{ dimension?: string }>)[0]
                    ?.dimension ?? null)
                : null;

              return (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg-elevated)",
                  }}
                >
                  {/* pass/fail icon */}
                  <div
                    style={{
                      flexShrink: 0,
                      width: 20,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {last == null ? (
                      <Icon.Dot
                        size={14}
                        style={{ color: "var(--text-muted)" }}
                      />
                    ) : last.pass ? (
                      <Icon.CheckCircle
                        size={14}
                        style={{ color: "var(--ok)" }}
                      />
                    ) : (
                      <Icon.XCircle
                        size={14}
                        style={{ color: "var(--crit)" }}
                      />
                    )}
                  </div>

                  {/* name + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {c.name}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: 4,
                          background: isMustFind
                            ? "color-mix(in srgb, var(--accent) 15%, transparent)"
                            : "color-mix(in srgb, var(--ok) 15%, transparent)",
                          color: isMustFind ? "var(--accent)" : "var(--ok)",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        {isMustFind ? t("mustFind") : t("mustNotFlag")}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {last == null ? (
                        t("neverRun")
                      ) : (
                        <>
                          {t("expectedGot", {
                            expected: expectedCount,
                            got: actualCount ?? 0,
                          })}
                          {last.recall != null &&
                            ` · recall ${Math.round(last.recall * 100)}%`}
                        </>
                      )}
                      {isSkill &&
                        withWithout &&
                        (withWithout.with || withWithout.without) && (
                          <span style={{ marginLeft: 8 }}>
                            {withWithout.with?.recall != null &&
                              `· ${t("withSkill")} ${Math.round(withWithout.with.recall * 100)}%`}
                            {withWithout.without?.recall != null &&
                              ` / ${t("withoutSkill")} ${Math.round(withWithout.without.recall * 100)}%`}
                          </span>
                        )}
                    </div>
                  </div>

                  {/* severity · category (finding-grounded) OR dimension
                      (rubric — `RubricAssessment` has no severity/category) */}
                  {isRubric
                    ? dimensionLabel && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          {t("dimension")}: {dimensionLabel}
                        </div>
                      )
                    : sevLabel && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          {sevLabel}
                          {catLabel ? ` · ${catLabel}` : ""}
                        </div>
                      )}

                  {/* actions */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexShrink: 0,
                    }}
                  >
                    <Button
                      kind="ghost"
                      size="sm"
                      icon="Play"
                      loading={
                        runAll.isPending ||
                        runAllSkill.isPending ||
                        runningIds.has(c.id)
                      }
                      onClick={() => {
                        setRunningIds((prev) => new Set(prev).add(c.id));
                        runCase
                          .mutateAsync({ id: c.id, ownerKind, ownerId })
                          .then((data) => {
                            const passed =
                              data.result.traces_passed ===
                              data.result.traces_total;
                            if (passed) {
                              notify.success(`${c.name} — passed`);
                            } else {
                              notify.error(`${c.name} — failed`);
                            }
                          })
                          .catch(() => {
                            notify.error(`${c.name} — run failed`);
                          })
                          .finally(() => {
                            setRunningIds((prev) => {
                              const next = new Set(prev);
                              next.delete(c.id);
                              return next;
                            });
                          });
                      }}
                    >
                      {runAll.isPending ||
                      runAllSkill.isPending ||
                      runningIds.has(c.id)
                        ? t("running")
                        : t("run")}
                    </Button>
                    <Button
                      kind="ghost"
                      size="sm"
                      icon="Edit"
                      onClick={() =>
                        setModalState({ mode: "edit", evalCase: c })
                      }
                    >
                      {t("edit")}
                    </Button>
                    <button
                      type="button"
                      aria-label={t("delete")}
                      title={t("delete")}
                      onClick={() =>
                        deleteCase.mutate({ id: c.id, ownerKind, ownerId })
                      }
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--text-muted)",
                        display: "inline-flex",
                        padding: 4,
                      }}
                    >
                      <Icon.Trash size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
