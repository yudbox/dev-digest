/* SelectAllClearAllControl — reusable select-all / clear-all toggle.
   When 0..N-1 checked → shows "Select All"; when all N checked → "Clear All". */
"use client";

import React from "react";

export function SelectAllClearAllControl({
  total,
  selected,
  onSelectAll,
  onClearAll,
  label = true,
}: {
  total: number;
  selected: number;
  onSelectAll: () => void;
  onClearAll: () => void;
  /** Whether to render a text label alongside the button. */
  label?: boolean;
}) {
  const allChecked = total > 0 && selected === total;

  return (
    <button
      type="button"
      onClick={allChecked ? onClearAll : onSelectAll}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 500,
        color: "var(--accent-text, #4f9cf9)",
        padding: 0,
      }}
    >
      {allChecked
        ? label
          ? "Clear"
          : "Clear All"
        : label
          ? "Select all"
          : "Select All"}
    </button>
  );
}
