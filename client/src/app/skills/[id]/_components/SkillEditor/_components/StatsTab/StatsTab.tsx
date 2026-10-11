/* Skill Editor → Stats. How a skill is used, for the global period. Reads stored
   runs and findings only — never starts a review or a model call. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, CircularScore, SectionLabel } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { SkillStatsResponse } from "@devdigest/shared";
import {
  AcceptRateValue,
  AgentIcon,
  CategoryDonut,
  KpiCard,
  PeriodHeader,
  StatsEmpty,
  StatsError,
  StatsSkeleton,
} from "@/components/stats";
import { useSkillStats } from "@/lib/hooks/performance";

/** "71% (12/17 PRs)", or a dash when the skill was loaded on no PR in the period. */
function PullFrequencyValue({ applied, loaded }: { applied: number; loaded: number }) {
  const t = useTranslations("skills.stats.kpi");
  if (loaded <= 0) return <>—</>;
  return <>{t("pullFrequencyValue", { pct: Math.round((applied / loaded) * 100), applied, loaded })}</>;
}

function KpiRow({ data }: { data: SkillStatsResponse }) {
  const t = useTranslations("skills.stats.kpi");
  const pct = data.accept.resolved > 0 ? Math.round((data.accept.accepted / data.accept.resolved) * 100) : null;
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
      {/* Period-independent: how many agents have the skill attached right now. */}
      <KpiCard label={t("usedBy")} testId="kpi-used-by" value={t("usedByValue", { count: data.usedBy })}>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{t("ranInPeriod", { count: data.ranInPeriod })}</span>
      </KpiCard>

      <KpiCard
        label={t("pullFrequency")}
        testId="kpi-pull"
        value={<PullFrequencyValue applied={data.pullFrequency.prsApplied} loaded={data.pullFrequency.prsLoaded} />}
      >
        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{t("pullCaption")}</span>
      </KpiCard>

      <KpiCard
        label={t("acceptRate")}
        testId="kpi-accept"
        value={<AcceptRateValue accepted={data.accept.accepted} resolved={data.accept.resolved} size={20} caption localFindings={data.findings} />}
        aside={pct !== null ? <CircularScore score={pct} size={34} stroke={4} /> : undefined}
      />

      <KpiCard label={t("findings")} testId="kpi-findings" value={data.findings} />
    </div>
  );
}

/** Agents that currently have the skill — a configuration list, so it does not depend on the period. */
function AgentsUsing({ agents }: { agents: SkillStatsResponse["agents"] }) {
  const t = useTranslations("skills.stats.agents");
  const router = useRouter();
  return (
    <Card>
      <SectionLabel icon="Cpu">{t("title")}</SectionLabel>
      <div data-testid="agents-using" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {agents.map((a) => (
          <div
            key={a.id}
            data-testid="agent-using-row"
            data-agent={a.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "8px 10px",
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              opacity: a.enabled ? 1 : 0.65,
            }}
          >
            <AgentIcon id={a.id} size={22} />
            <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{a.name}</span>
            {!a.enabled && <Badge>{t("disabled")}</Badge>}
            <button
              type="button"
              onClick={() => router.push(`/agents/${a.id}?tab=stats`)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--accent-text)", fontSize: 12 }}
            >
              {t("open")}
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function StatsTab({ skillId }: { skillId: string }) {
  const t = useTranslations("skills.stats");
  const { data, isPending, isError, refetch } = useSkillStats(skillId);

  // Attached to no agent: there is nothing to measure at all.
  if (data && data.usedBy === 0) {
    return (
      <div data-testid="skill-no-usage" style={{ padding: "24px 28px" }}>
        <StatsEmpty title={t("noUsageTitle")} body={t("noUsageBody")} icon="BarChart" />
      </div>
    );
  }

  const neverRan = data !== undefined && !data.hasAnyRuns;
  const noRunsInPeriod = data !== undefined && data.hasAnyRuns && data.loadedRunsInWindow === 0;

  return (
    <div style={{ padding: "20px 28px 40px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <PeriodHeader window={data?.window} />
      </div>

      {isError ? (
        <StatsError onRetry={() => void refetch()} />
      ) : isPending || !data ? (
        <StatsSkeleton cards={4} rows={2} />
      ) : neverRan || noRunsInPeriod ? (
        <div style={{ display: "grid", gap: 20 }}>
          <div data-testid={neverRan ? "skill-never-ran" : "skill-no-runs"}>
            <StatsEmpty
              icon="BarChart"
              title={neverRan ? t("neverTitle") : t("noRunsTitle")}
              body={neverRan ? t("neverBody") : t("noRunsBody")}
            />
          </div>
          <AgentsUsing agents={data.agents} />
        </div>
      ) : (
        <>
          <KpiRow data={data} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <AgentsUsing agents={data.agents} />
            <Card>
              <SectionLabel icon="Tag">{t("byCategory")}</SectionLabel>
              <div style={{ display: "grid", placeItems: "center", paddingTop: 6 }}>
                <CategoryDonut categories={data.categories} />
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
