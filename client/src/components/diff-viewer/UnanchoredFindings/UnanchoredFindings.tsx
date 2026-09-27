/* UnanchoredFindings — end-of-file block for findings whose `start_line`
 * isn't among the file's rendered new-side lines (AC-29): a deleted line, a
 * truncated/large patch, or a file with no patch at all. Same marker/card
 * mechanics as an inline line — only the "Line N" location changes. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { FindingMarker } from "../FindingMarker";
import { InlineFindingCard } from "../InlineFindingCard";
import type { DiffFindingsApi } from "../findings";

export function UnanchoredFindings({
  findings,
  api,
}: {
  findings: FindingRecord[];
  api: DiffFindingsApi;
}) {
  const t = useTranslations("prReview.smartDiff");
  const [openIds, setOpenIds] = React.useState<Set<string>>(new Set());

  if (findings.length === 0) return null;

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const byLine = new Map<number, FindingRecord[]>();
  for (const f of findings) {
    const list = byLine.get(f.start_line) ?? [];
    list.push(f);
    byLine.set(f.start_line, list);
  }

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        marginTop: 4,
        padding: "10px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--text-muted)",
        }}
      >
        {t("outsideDiff")}
      </div>
      {[...byLine.entries()].map(([line, lineFindings]) => (
        <div key={line} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("lineLabel", { line })}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {lineFindings.map((f) => (
                <FindingMarker
                  key={f.id}
                  f={f}
                  open={openIds.has(f.id)}
                  onClick={() => toggle(f.id)}
                />
              ))}
            </div>
          </div>
          {lineFindings
            .filter((f) => openIds.has(f.id))
            .map((f) => (
              <InlineFindingCard key={f.id} f={f} api={api} />
            ))}
        </div>
      ))}
    </div>
  );
}
