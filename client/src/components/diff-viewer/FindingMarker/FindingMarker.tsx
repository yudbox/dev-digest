/* FindingMarker — one coloured, clickable marker per finding on a diff line
 * (or in the end-of-file "outside the diff" block). Several findings on the
 * same line each get their own marker, stacked (AC-18). Toggling opens/closes
 * that finding's InlineFindingCard only — no navigation, no request. */
"use client";

import React from "react";
import { Icon, SEV } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";

export function FindingMarker({
  f,
  open,
  onClick,
}: {
  f: FindingRecord;
  open: boolean;
  onClick: () => void;
}) {
  const meta = SEV[f.severity];
  const SIcon = Icon[meta.icon];
  const accepted = !!f.accepted_at;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={open}
      title={f.title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        flexShrink: 0,
        borderRadius: 4,
        border: `1px solid ${meta.c}`,
        background: open ? meta.c : "transparent",
        color: open ? "var(--bg-primary, #fff)" : meta.c,
        opacity: accepted ? 0.45 : 1,
        cursor: "pointer",
        padding: 0,
      }}
    >
      <SIcon size={11} />
    </button>
  );
}
