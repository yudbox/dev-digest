/* /multi-agent-review/new — Configure run page (AC-10 through AC-15, AC-64).
   Step 1: Pick a PR. Step 2: Pick agents (all pre-checked by default). */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@devdigest/ui";
import { Checkbox } from "@devdigest/ui";
import { useAgents } from "../../../lib/hooks/agents";
import { useRunMultiAgentReview } from "../../../lib/hooks/reviews";
import { useRepos } from "../../../lib/hooks/repos";
import { api } from "../../../lib/api";
import { SelectAllClearAllControl } from "../../../components/agent-picker/SelectAllClearAllControl";
import { agentIcon } from "../agentIconMap";
import type { Agent } from "@devdigest/shared";

interface PrOption {
  id: string;
  number: number;
  title: string;
}

/** Aggregates PRs across all repos using real API endpoints. */
function usePrsForWorkspace(): { prs: PrOption[]; isLoading: boolean } {
  const repos = useRepos();
  const repoIds = repos.data?.map((r) => r.id) ?? [];
  // We pull PRs for each repo individually (existing API) and merge them.
  // Hook count is stable because repoIds stabilises after first load.
  const [prs, setPrs] = React.useState<PrOption[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (repos.isLoading) return;
    if (repoIds.length === 0) { setLoading(false); return; }

    let cancelled = false;
    Promise.allSettled(
      repoIds.map((id) =>
        api
          .get<{ id: string; number: number; title: string }[]>(`/repos/${id}/pulls`)
          .catch(() => [] as { id: string; number: number; title: string }[]),
      ),
    ).then((results) => {
      if (cancelled) return;
      const merged: PrOption[] = results.flatMap((r) =>
        r.status === "fulfilled"
          ? (r.value as { id: string; number: number; title: string }[]).map(
              (p) => ({ id: p.id, number: p.number, title: p.title }),
            )
          : [],
      );
      setPrs(merged);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [repoIds.join(","), repos.isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  return { prs, isLoading: loading };
}

export default function ConfigureRunPage() {
  const router = useRouter();
  const params = useSearchParams();
  const prefillPrId = params.get("prId") ?? undefined;

  const [prId, setPrId] = React.useState<string>(prefillPrId ?? "");
  const [prSearch, setPrSearch] = React.useState("");
  const [prOpen, setPrOpen] = React.useState(false);

  const allAgents: Agent[] = useAgents().data ?? [];
  const { prs, isLoading: prsLoading } = usePrsForWorkspace();
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
    router.push(`/multi-agent-review/${res.multi_agent_run_id}`);
  };

  const buttonLabel =
    n === 0 ? "Run multi-agent review" : `Run multi-agent review (${n})`;

  return (
    <div style={{ padding: "24px 32px", maxWidth: 720 }}>
      {/* Breadcrumb */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 20,
          fontSize: 13,
          color: "var(--text-muted)",
        }}
      >
        <a
          href="/multi-agent-review"
          style={{ color: "var(--text-muted)", textDecoration: "none" }}
        >
          Multi-Agent Review
        </a>
        <Icon.ChevronRight size={14} />
        <span style={{ color: "var(--text)" }}>Configure run</span>
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>
        Run a Multi-Agent Review
      </h1>
      <p
        style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 28px" }}
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

        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setPrOpen((o) => !o)}
            style={{
              width: "100%",
              padding: "9px 14px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface-raised)",
              color: selectedPr ? "var(--text)" : "var(--text-muted)",
              fontSize: 13,
              textAlign: "left",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
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
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                borderRadius: 9,
                boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                zIndex: 50,
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
                    background: "var(--surface)",
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
                      borderBottom:
                        "1px solid var(--border-subtle, transparent)",
                      background:
                        prId === p.id
                          ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                          : "transparent",
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
            <span style={{ fontSize: 14, fontWeight: 600 }}>Agents to run</span>
          </div>
          <SelectAllClearAllControl
            total={allAgents.length}
            selected={n}
            onSelectAll={() => setChecked(new Set(allAgents.map((a) => a.id)))}
            onClearAll={() => setChecked(new Set())}
            label={false}
          />
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
            }}
          >
            <Icon.GitPullRequest size={28} style={{ opacity: 0.3 }} />
            Pick a pull request first
            <span style={{ fontSize: 12 }}>
              Choose which PR to review above, then select the agents to run on
              it.
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {allAgents.map((agent) => {
              const AgentIcon =
                Icon[agentIcon(agent.name, agent.description)] ?? Icon.Bot;
              const isChecked = checked.has(agent.id);
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
                      ? "1px solid var(--accent, #4f9cf9)"
                      : "1px solid var(--border)",
                    background: isChecked
                      ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                      : "var(--surface-raised)",
                    cursor: "pointer",
                    transition: "all 0.12s",
                  }}
                >
                  <Checkbox
                    checked={isChecked}
                    onChange={() => toggle(agent.id)}
                  />
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: "var(--surface)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <AgentIcon
                      size={16}
                      style={{ color: "var(--text-muted)" }}
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
            border: "none",
            background: canRun ? "var(--accent, #4f9cf9)" : "var(--surface)",
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
      </div>
    </div>
  );
}
