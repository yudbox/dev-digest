/* AgentEditor — agent editor with Config, Skills, Context, Evals, Stats and CI
   tabs. Tab state lives in ?tab= (so /agents/:id?tab=stats deep-links). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { SkillsTab } from "./_components/SkillsTab/SkillsTab";
import { ContextTab } from "./_components/ContextTab/ContextTab";
import { StatsTab } from "./_components/StatsTab";
import { EvalsTab } from "@/components/evals/EvalsTab";
import { CiTab } from "../CiTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function AgentEditor({
  agent,
  tab,
  onTab,
}: {
  agent: Agent;
  tab: string;
  onTab: (t: string) => void;
}) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({
    key: tb.key,
    label: t(tb.labelKey),
    icon: tb.icon,
  }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {tab === "config" && <ConfigTab agent={agent} />}
        {tab === "skills" && <SkillsTab agentId={agent.id} />}
        {tab === "context" && <ContextTab agent={agent} />}
        {tab === "evals" && <EvalsTab ownerKind="agent" ownerId={agent.id} />}
        {tab === "stats" && <StatsTab agentId={agent.id} agentName={agent.name} />}
        {tab === "ci" && <CiTab agent={agent} />}
      </div>
    </div>
  );
}

