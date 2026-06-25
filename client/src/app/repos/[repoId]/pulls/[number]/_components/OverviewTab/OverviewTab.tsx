"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { usePullIntent, useRecalculateIntent } from "@/lib/hooks/pulls";
import { s } from "./styles";
import type { CSSProperties } from "react";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null | undefined;
}

// ── Placeholder: PR Brief ─────────────────────────────────────────────────────
function PrBriefPlaceholder() {
  return (
    <div
      style={
        {
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-elevated)",
          padding: "16px 18px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        } satisfies CSSProperties
      }
    >
      <div
        style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}
      >
        {/* verdict row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(239,68,68,0.15)",
              color: "#f87171",
              borderRadius: 6,
              padding: "3px 10px",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            🔴 Request changes
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            6 findings · 2 blockers
          </span>
        </div>
        {/* summary */}
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.5,
          }}
        >
          Solid middleware approach, but a Stripe secret key is committed in
          plaintext and the user-list endpoint introduces an N+1 query under the
          new limiter. Two blockers before merge.
        </p>
        {/* cost row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <span>$ 0.014</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>8.2K → 1.3K tokens</span>
        </div>
      </div>
      {/* score badge */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          flexShrink: 0,
        }}
      >
        <svg width={56} height={56} viewBox="0 0 56 56">
          <circle
            cx={28}
            cy={28}
            r={24}
            fill="none"
            stroke="var(--border)"
            strokeWidth={5}
          />
          <circle
            cx={28}
            cy={28}
            r={24}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={5}
            strokeDasharray={`${2 * Math.PI * 24 * 0.61} ${2 * Math.PI * 24}`}
            strokeLinecap="round"
            transform="rotate(-90 28 28)"
          />
          <text
            x={28}
            y={33}
            textAnchor="middle"
            fontSize={14}
            fontWeight={700}
            fill="var(--text-primary)"
          >
            61
          </text>
        </svg>
        <span
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          PR Score
        </span>
      </div>
    </div>
  );
}

// ── Placeholder: Blast Radius ─────────────────────────────────────────────────
function BlastRadiusPlaceholder() {
  return (
    <div
      style={
        {
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-elevated)",
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          height: "100%",
          boxSizing: "border-box",
        } satisfies CSSProperties
      }
    >
      {/* header stats */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          ⟨⟩ 2 symbols
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          ↳ 14 callers
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          ⊡ 3 endpoints
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          ⏱ 1 cron
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            style={{
              fontSize: 11,
              color: "var(--text-primary)",
              background: "var(--bg-surface, rgba(255,255,255,0.08))",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "2px 8px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Tree
          </button>
          <button
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            Graph
          </button>
        </div>
      </div>

      {/* symbol rows */}
      {[
        {
          name: "rateLimit()",
          callers: 4,
          refs: [
            "src/api/public/index.ts:23",
            "src/api/public/webhooks.ts:45",
            "src/api/public/health.ts:11",
            "src/server.ts:88",
          ],
          endpoints: [
            "GET /api/public/items",
            "POST /api/public/webhooks",
            "GET /api/public/health",
          ],
          cron: "reset-rate-buckets (hourly)",
        },
        {
          name: "bucketKey()",
          callers: 2,
          refs: [],
          endpoints: [],
          cron: null,
        },
      ].map((sym) => (
        <div
          key={sym.name}
          style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontFamily: "monospace",
                fontSize: 13,
                color: "var(--text-primary)",
                fontWeight: 600,
              }}
            >
              ⟨⟩ {sym.name}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {sym.callers} callers
            </span>
          </div>
          {sym.refs.map((r) => (
            <div
              key={r}
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                paddingLeft: 12,
                lineHeight: 1.8,
              }}
            >
              ↳ <span style={{ fontFamily: "monospace" }}>{r}</span>
            </div>
          ))}
          {sym.endpoints.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                marginTop: 6,
                paddingLeft: 12,
              }}
            >
              {sym.endpoints.map((e) => (
                <span
                  key={e}
                  style={{
                    fontSize: 11,
                    padding: "2px 7px",
                    borderRadius: 4,
                    fontFamily: "monospace",
                    background: "rgba(99,102,241,0.15)",
                    color: "#818cf8",
                  }}
                >
                  {e}
                </span>
              ))}
              {sym.cron && (
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 7px",
                    borderRadius: 4,
                    fontFamily: "monospace",
                    background: "rgba(245,158,11,0.15)",
                    color: "#fbbf24",
                  }}
                >
                  {sym.cron}
                </span>
              )}
            </div>
          )}
        </div>
      ))}

      {/* prior PRs */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          paddingTop: 8,
          fontSize: 12,
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>⏱ Prior PRs touching these files</span>
        <span style={{ fontWeight: 600 }}>3</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function OverviewTab({ prBody, prId }: OverviewTabProps) {
  const { data: intent, isLoading } = usePullIntent(prId);
  const recalc = useRecalculateIntent(prId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* PR Brief — full width */}
      <section>
        <SectionLabel icon="FileText">PR Brief</SectionLabel>
        <PrBriefPlaceholder />
      </section>

      {/* 2-column: Intent + Blast Radius */}
      <div
        style={
          {
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            alignItems: "stretch",
          } satisfies CSSProperties
        }
      >
        <IntentCard
          intent={intent}
          isLoading={isLoading}
          onRecalculate={() => recalc.mutate()}
          recalculating={recalc.isPending}
        />
        <section style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <SectionLabel icon="GitPullRequest">Blast Radius</SectionLabel>
          <BlastRadiusPlaceholder />
        </section>
      </div>

      {/* PR Description */}
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </div>
  );
}
