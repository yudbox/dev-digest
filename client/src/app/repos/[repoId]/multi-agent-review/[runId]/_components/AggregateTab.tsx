"use client";

import React from "react";
import type { AggregateResponse, AggregatedFinding, MultiAgentRun } from "@devdigest/shared";
import { useAggregateMutation } from "../../../../../../lib/hooks/reviews";
import { useQueryClient } from "@tanstack/react-query";

interface AggregateTabProps {
  run: MultiAgentRun;
  repoId: string;
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "#f87171",
  WARNING: "#fb923c",
  SUGGESTION: "#60a5fa",
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 7px",
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 700,
        background: SEV_COLOR[severity] ?? "#94a3b8",
        color: "#fff",
        whiteSpace: "nowrap",
      }}
    >
      {severity}
    </span>
  );
}

function CardChip({
  source,
  prNumber,
  repoId,
}: {
  source: AggregatedFinding["sources"][number];
  prNumber: number;
  repoId: string;
}) {
  const href = `/repos/${repoId}/pulls/${prNumber}?tab=findings&finding=${source.finding_id}`;
  return (
    <a
      href={href}
      title={source.agent_name}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 8px",
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 500,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        color: "var(--text-muted)",
        textDecoration: "none",
        whiteSpace: "nowrap",
        cursor: "pointer",
      }}
    >
      {source.agent_name}
    </a>
  );
}

function CommentCell({ comment }: { comment: string }) {
  const [copied, setCopied] = React.useState(false);

  const enPart = comment.includes("\n\n---\n\n")
    ? comment.split("\n\n---\n\n")[0]!.trim()
    : comment;

  const handleCopy = () => {
    void navigator.clipboard.writeText(enPart).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {comment}
      </div>
      <button
        type="button"
        title={copied ? "Copied!" : "Copy EN comment"}
        onClick={handleCopy}
        style={{
          alignSelf: "flex-start",
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 7px",
          borderRadius: 5,
          fontSize: 11,
          cursor: "pointer",
          border: "1px solid var(--border)",
          background: copied ? "var(--accent, #4f9cf9)" : "var(--surface)",
          color: copied ? "#fff" : "var(--text-muted)",
          transition: "background 0.15s, color 0.15s",
        }}
      >
        📋 {copied ? "Copied!" : "Copy EN"}
      </button>
    </div>
  );
}

function AggregateTable({
  result,
  repoId,
  prNumber,
}: {
  result: AggregateResponse;
  repoId: string;
  prNumber: number;
}) {
  if (result.groups.length === 0) {
    return (
      <div style={{ padding: "28px 0", color: "var(--text-muted)", fontSize: 13 }}>
        All agents returned zero findings — nothing to aggregate.
      </div>
    );
  }

  const thStyle: React.CSSProperties = {
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textAlign: "left",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
    position: "sticky",
    top: 0,
    background: "var(--surface)",
    zIndex: 1,
  };

  const tdStyle: React.CSSProperties = {
    padding: "9px 10px",
    fontSize: 12,
    color: "var(--text)",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "top",
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
        <thead>
          <tr>
            <th style={thStyle}>Severity</th>
            <th style={thStyle}>Category</th>
            <th style={thStyle}>File:Line</th>
            <th style={{ ...thStyle, width: "22%" }}>Finding</th>
            <th style={thStyle}>Cards</th>
            <th style={{ ...thStyle, width: "30%" }}>Reviewer Comment</th>
          </tr>
        </thead>
        <tbody>
          {result.groups.map((g) => (
            <tr key={g.id}>
              <td style={tdStyle}>
                <SeverityBadge severity={g.severity} />
              </td>
              <td style={tdStyle}>{g.category}</td>
              <td style={{ ...tdStyle, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                {g.file}:{g.start_line}
              </td>
              <td style={tdStyle}>{g.title}</td>
              <td style={tdStyle}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {g.sources.map((src) => (
                    <CardChip
                      key={src.finding_id}
                      source={src}
                      prNumber={prNumber}
                      repoId={repoId}
                    />
                  ))}
                </div>
              </td>
              <td style={tdStyle}>
                <CommentCell comment={g.reviewer_comment} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AggregateTab({ run, repoId }: AggregateTabProps) {
  const qc = useQueryClient();
  const mutation = useAggregateMutation(run.id);

  // Read from cache if already run this session
  const cached = qc.getQueryData<AggregateResponse>(["aggregate", run.id]);

  const hasDoneColumns = run.columns.some((c) => c.status === "done");

  const handleRun = () => {
    mutation.mutate();
  };

  const result = mutation.data ?? cached;

  return (
    <div style={{ paddingTop: 12 }}>
      {/* Controls row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <button
          type="button"
          onClick={handleRun}
          disabled={mutation.isPending || !hasDoneColumns}
          style={{
            padding: "6px 14px",
            borderRadius: 7,
            fontSize: 13,
            fontWeight: 600,
            cursor: mutation.isPending || !hasDoneColumns ? "not-allowed" : "pointer",
            border: "none",
            background: mutation.isPending ? "var(--surface-raised)" : "var(--accent, #4f9cf9)",
            color: mutation.isPending ? "var(--text-muted)" : "#fff",
            opacity: !hasDoneColumns ? 0.5 : 1,
            transition: "background 0.12s",
          }}
        >
          {mutation.isPending
            ? "Running…"
            : result
              ? "Re-run"
              : "Run Aggregate"}
        </button>

        {!hasDoneColumns && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Waiting for agents to complete…
          </span>
        )}

        {result && !mutation.isPending && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Generated by {result.model} · {result.source_findings_total} source findings · {result.groups.length} groups
          </span>
        )}

        {mutation.isError && (
          <span style={{ fontSize: 12, color: "var(--critical, #f87171)" }}>
            {(mutation.error as Error).message}
          </span>
        )}
      </div>

      {/* Table or empty state */}
      {!result && !mutation.isPending && (
        <div style={{ padding: "28px 0", color: "var(--text-muted)", fontSize: 13 }}>
          Click &ldquo;Run Aggregate&rdquo; to semantically deduplicate all agent findings.
        </div>
      )}

      {mutation.isPending && (
        <div style={{ padding: "28px 0", color: "var(--text-muted)", fontSize: 13 }}>
          Deduplicating findings…
        </div>
      )}

      {result && !mutation.isPending && (
        <AggregateTable
          result={result}
          repoId={repoId}
          prNumber={run.pr_number ?? 0}
        />
      )}
    </div>
  );
}
