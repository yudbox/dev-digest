/* /repos/[repoId]/multi-agent-review/new — Configure run page (AC-10 through AC-15, AC-64).
   Step 1: Pick a PR. Step 2: Pick agents (all pre-checked by default). */
"use client";

import React from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { Icon } from "@devdigest/ui";
import { useAgents } from "../../../../../lib/hooks/agents";
import { useRunMultiAgentReview } from "../../../../../lib/hooks/reviews";
import { usePulls } from "../../../../../lib/hooks/pulls";
import { SelectAllClearAllControl } from "../../../../../components/agent-picker/SelectAllClearAllControl";
import { agentIcon, agentColor as getAgentColor } from "../agentIconMap";
import type { Agent } from "@devdigest/shared";
import { AppShell } from "../../../../../components/app-shell";


export default function ConfigureRunPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { repoId } = useParams<{ repoId: string }>();
  const base = `/repos/${repoId}/multi-agent-review`;
  const prefillPrId = searchParams.get("prId") ?? undefined;

  const [prId, setPrId] = React.useState<string>(prefillPrId ?? "");
  const [prSearch, setPrSearch] = React.useState("");
  const [prOpen, setPrOpen] = React.useState(false);

  const allAgents: Agent[] = useAgents().data ?? [];
  const pullsQuery = usePulls(repoId);
  const prs = (pullsQuery.data ?? [])
    .map((p) => ({
      id: p.id ?? "",
      number: p.number,
      title: p.title,
    }))
    .filter((p) => p.id);
  const prsLoading = pullsQuery.isLoading;
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const runMutation = useRunMultiAgentReview();

  // Pre-check all agents when loaded
  React.useEffect(() => {
    if (allAgents.length > 0) setChecked(new Set(allAgents.map((a) => a.id)));
  }, [allAgents.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const n = checked.size;
  const selectedAgents = allAgents.filter((a) => checked.has(a.id));
  const estMs = selectedAgents.reduce(
    (m, a) => Math.max(m, a.avg_duration_ms ?? 0),
    0,
  );
  const estCost = selectedAgents.reduce((s, a) => s + (a.avg_cost_usd ?? 0), 0);

  const selectedPr = prs.find((p) => p.id === prId);
  const filteredPrs = prSearch
    ? prs.filter(
        (p) =>
          p.title.toLowerCase().includes(prSearch.toLowerCase()) ||
          String(p.number).includes(prSearch),
      )
    : prs;

  const canRun = !!prId && n > 0 && !runMutation.isPending;

  const handleRun = async () => {
    if (!canRun) return;
    const res = await runMutation.mutateAsync({ prId, agentIds: [...checked] });
    router.push(`${base}/${res.multi_agent_run_id}`);
  };

  const buttonLabel =
    !prId || n === 0 ? "Run multi-agent review" : `Run multi-agent review (${n})`;

  return (
    <AppShell
      crumb={[
        { label: "Multi-Agent Review", href: base },
        { label: "Configure run" },
      ]}
    >
      <div style={{ padding: "24px 32px", maxWidth: 720, margin: "0 auto" }}>

        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>
          Run a Multi-Agent Review
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            margin: "0 0 28px",
          }}
        >
          Pick a pull request and choose which agents to fan out — they run in
          parallel and you compare their findings side by side.
        </p>

        {/* Step 1: PR picker */}
        <div style={{ marginBottom: 28 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "var(--accent, #4f9cf9)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              1
            </span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Pull request</span>
          </div>

          <div style={{ position: "relative", background: "#1e1e1e", borderRadius: 8 }}>
            <button
              type="button"
              onClick={() => setPrOpen((o) => !o)}
              style={{
                width: "100%",
                padding: "9px 14px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                color: selectedPr ? "var(--text)" : "var(--text-muted)",
                fontSize: 13,
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "transparent",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon.GitPullRequest size={14} />
                {prsLoading
                  ? "Loading pull requests…"
                  : selectedPr
                    ? `#${selectedPr.number} · ${selectedPr.title}`
                    : "Select a pull request…"}
              </span>
              <Icon.ChevronDown size={14} />
            </button>

            {prOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: 0,
                  background: "#1e1e1e",
                  border: "1px solid var(--border)",
                  borderRadius: 9,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                  zIndex: 100,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "8px 10px",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <input
                    autoFocus
                    placeholder="Search…"
                    value={prSearch}
                    onChange={(e) => setPrSearch(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "5px 8px",
                      borderRadius: 5,
                      border: "1px solid var(--border)",
                      background: "#2a2a2a",
                      color: "var(--text)",
                      fontSize: 12,
                    }}
                  />
                </div>
                <div style={{ maxHeight: 240, overflowY: "auto" }}>
                  {filteredPrs.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => {
                        setPrId(p.id);
                        setPrOpen(false);
                        setPrSearch("");
                      }}
                      style={{
                        padding: "9px 14px",
                        cursor: "pointer",
                        fontSize: 13,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        background:
                          prId === p.id
                            ? "rgba(79, 156, 249, 0.15)"
                            : "#1e1e1e",
                      }}
                    >
                      <Icon.GitPullRequest size={13} />
                      <span
                        style={{ color: "var(--text-muted)", marginRight: 4 }}
                      >
                        #{p.number}
                      </span>
                      {p.title}
                    </div>
                  ))}
                  {filteredPrs.length === 0 && (
                    <div
                      style={{
                        padding: "12px 14px",
                        fontSize: 13,
                        color: "var(--text-muted)",
                      }}
                    >
                      No PRs found
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Agents (shown only after PR is chosen) */}
        <div style={{ opacity: prId ? 1 : 0.4, transition: "opacity 0.2s" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: prId ? "var(--accent, #4f9cf9)" : "var(--border)",
                  color: prId ? "#fff" : "var(--text-muted)",
                  fontSize: 12,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                2
              </span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                Agents to run
              </span>
            </div>
            {prId && (
              <SelectAllClearAllControl
                total={allAgents.length}
                selected={n}
                onSelectAll={() =>
                  setChecked(new Set(allAgents.map((a) => a.id)))
                }
                onClearAll={() => setChecked(new Set())}
                label={false}
              />
            )}
          </div>

          {!prId ? (
            <div
              style={{
                border: "1px dashed var(--border)",
                borderRadius: 10,
                padding: "40px 0",
                textAlign: "center",
                fontSize: 13,
                color: "var(--text-muted)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                background: "#1e1e1e",
              }}
            >
              <Icon.GitPullRequest size={28} style={{ opacity: 0.3 }} />
              Pick a pull request first
              <span style={{ fontSize: 12 }}>
                Choose which PR to review above, then select the agents to run
                on it.
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {allAgents.map((agent) => {
                const AgentIcon =
                  (Icon as Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>>)[agentIcon(agent.name, agent.description)] ?? Icon.Bot;
                const isChecked = checked.has(agent.id);
                const agentColor = getAgentColor(agent.id);
                return (
                  <div
                    key={agent.id}
                    onClick={() => toggle(agent.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      borderRadius: 9,
                      border: isChecked
                        ? `1px solid ${agentColor}`
                        : "1px solid var(--border)",
                      background: isChecked
                        ? `color-mix(in srgb, ${agentColor} 10%, transparent)`
                        : "#1e1e1e",
                      cursor: "pointer",
                      transition: "all 0.12s",
                    }}
                  >
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        border: isChecked ? "none" : "1.5px solid var(--border)",
                        background: isChecked ? agentColor : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        cursor: "pointer",
                      }}
                      onClick={(e) => { e.stopPropagation(); toggle(agent.id); }}
                    >
                      {isChecked && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: `color-mix(in srgb, ${agentColor} 15%, transparent)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <AgentIcon
                        size={16}
                        style={{ color: agentColor }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "var(--text)",
                        }}
                      >
                        {agent.name}
                      </div>
                      {agent.description && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--text-muted)",
                            marginTop: 2,
                          }}
                        >
                          {agent.description}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        flexShrink: 0,
                      }}
                    >
                      {agent.avg_duration_ms
                        ? `~${Math.round(agent.avg_duration_ms / 1000)}s`
                        : ""}
                      {agent.avg_cost_usd
                        ? ` · $${agent.avg_cost_usd.toFixed(2)}`
                        : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer: summary + run button */}
        <div
          style={{
            marginTop: 24,
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <button
            type="button"
            disabled={!canRun}
            onClick={handleRun}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: canRun ? "pointer" : "not-allowed",
              border: canRun ? "none" : "1px solid var(--border)",
              background: canRun ? "var(--accent, #4f9cf9)" : "#2a2a2a",
              color: canRun ? "#fff" : "var(--text-muted)",
              transition: "background 0.15s",
            }}
          >
            <Icon.Users size={15} />
            {runMutation.isPending ? "Starting…" : buttonLabel}
          </button>
          {prId && n > 0 && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              ≈ {estMs ? `${(estMs / 1000).toFixed(1)}s` : "?"}
              {estCost > 0 ? ` · $${estCost.toFixed(2)}` : ""}
              {n > 1 ? " · parallel fan-out" : ""}
            </span>
          )}

          {prId && (
            <button
              type="button"
              onClick={() => router.push("/agents")}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Icon.Settings size={12} />
              Configure agents…
            </button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
