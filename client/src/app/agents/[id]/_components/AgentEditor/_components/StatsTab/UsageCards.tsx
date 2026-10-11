"use client";

import React from "react";
import { BarRow, Card, SectionLabel } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { AgentStatsResponse } from "@devdigest/shared";
import { noDataBefore, sharePct } from "./helpers";

const muted: React.CSSProperties = { fontSize: 11.5, color: "var(--text-muted)" };

function Note({ children }: { children: React.ReactNode }) {
  return <div style={{ ...muted, marginTop: 8 }}>{children}</div>;
}

/**
 * Most-used skills: for each skill, the share of the agent's runs (that recorded
 * skill usage) in which the model reported applying it. Runs from before usage
 * was recorded are left out, and the card says so rather than showing 0%.
 */
export function SkillsCard({ data }: { data: AgentStatsResponse }) {
  const t = useTranslations("agents.stats");
  const since = noDataBefore(data.window.from, data.skillsTrackingSince, data.window.tz);
  return (
    <Card>
      <SectionLabel icon="Sparkles">{t("skills.title")}</SectionLabel>
      <div style={muted}>{t("skills.hint")}</div>
      <div data-testid="skills-card" style={{ marginTop: 6 }}>
        {!data.hasSkillsAttached ? (
          <Note>{t("skills.none")}</Note>
        ) : data.skills.length === 0 ? (
          <Note>{t("skills.noUsage")}</Note>
        ) : (
          data.skills.map((s) => {
            const pct = sharePct(s.applied, s.loaded);
            return <BarRow key={s.skillId} label={s.name} value={pct} max={100} color="var(--accent)" suffix={`${pct}%`} />;
          })
        )}
        {since && <Note>{t("noDataBefore", { date: since })}</Note>}
      </div>
    </Card>
  );
}

/** Most-pulled memory: share of tracked runs in which each entry was pulled into the prompt. */
export function MemoryCard({ data }: { data: AgentStatsResponse }) {
  const t = useTranslations("agents.stats");
  const since = noDataBefore(data.window.from, data.memoryTrackingSince, data.window.tz);
  return (
    <Card>
      <SectionLabel icon="Database">{t("memory.title")}</SectionLabel>
      <div style={muted}>{t("memory.hint")}</div>
      <div data-testid="memory-card" style={{ marginTop: 6 }}>
        {data.memory.length === 0 ? (
          <Note>{t("memory.none")}</Note>
        ) : (
          data.memory.map((m) => {
            const pct = sharePct(m.pulled, m.tracked);
            return <BarRow key={m.memoryId} label={m.preview} value={pct} max={100} color="#8b5cf6" suffix={`${pct}%`} />;
          })
        )}
        {since && <Note>{t("noDataBefore", { date: since })}</Note>}
      </div>
    </Card>
  );
}
