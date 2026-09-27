"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import type { SymbolRow } from "./helpers";
import { endpointPillClass } from "./helpers";
import { vcsBlobUrl, type VcsUrlRepo } from "@/lib/utils/vcsUrls";

interface SymbolListProps {
  rows: SymbolRow[];
  repo?: VcsUrlRepo | null;
  headSha?: string | null;
}

export function SymbolList({ rows, repo, headSha }: SymbolListProps) {
  const t = useTranslations("prReview.blastRadius");
  const tb = useTranslations("blast");
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col">
      {rows.map((sym) => {
        const isOpen = openSymbol === sym.name;
        const rowKey = `${sym.file}:${sym.name}`;
        return (
          <div key={rowKey} className="border-t border-[var(--border)] pt-2.5">
            <button
              onClick={() => setOpenSymbol(isOpen ? null : sym.name)}
              className="bg-transparent border-none cursor-pointer p-0 w-full flex items-center justify-between mb-1.5 gap-2"
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span
                  className="text-[var(--text-muted)] flex-shrink-0 transition-transform duration-150"
                  style={{
                    display: "inline-block",
                    transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                  }}
                >
                  ▸
                </span>
                <span className="text-[var(--accent-text,#60a5fa)] flex-shrink-0 text-[12px]">
                  ⟨⟩
                </span>
                <span className="font-mono text-[13px] text-[var(--text-primary)] font-semibold truncate">
                  {sym.name}
                </span>
              </span>
              <span className="text-[11px] text-[var(--text-muted)] flex-shrink-0">
                {t("callersCount", { count: sym.callers.length })}
              </span>
            </button>

            {isOpen && (
              <>
                {sym.callers.length === 0 && (
                  <div className="text-xs text-[var(--text-muted)] pl-4 leading-7">
                    {tb("noDownstream", { count: 1 })}
                  </div>
                )}

                {sym.callers.map((c) => {
                  const label = (
                    <>
                      <span className="flex-shrink-0">↳</span>
                      <span className="font-mono truncate">
                        {c.file}:{c.line}
                      </span>
                    </>
                  );
                  // Callers live outside this PR's diff, so link to the file
                  // at the PR head on the VCS host rather than the diff tab.
                  return repo && headSha ? (
                    <a
                      key={`${c.file}:${c.line}`}
                      href={vcsBlobUrl(repo, headSha, c.file, c.line)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--text-secondary)] pl-4 leading-7 cursor-pointer hover:text-[var(--text-primary)] flex items-center gap-1 min-w-0 no-underline"
                      title={`${c.file}:${c.line}`}
                    >
                      {label}
                    </a>
                  ) : (
                    <div
                      key={`${c.file}:${c.line}`}
                      className="text-xs text-[var(--text-secondary)] pl-4 leading-7 flex items-center gap-1 min-w-0"
                      title={`${c.file}:${c.line}`}
                    >
                      {label}
                    </div>
                  );
                })}

                {(sym.endpoints.length > 0 || sym.crons.length > 0) && (
                  <div className="flex gap-1.5 flex-wrap mt-1.5 pl-3">
                    {sym.endpoints.map((e) => (
                      <span
                        key={e}
                        className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${endpointPillClass(e)}`}
                      >
                        {e}
                      </span>
                    ))}
                    {sym.crons.map((c) => (
                      <span
                        key={c}
                        className="text-[11px] px-1.5 py-0.5 rounded font-mono bg-amber-500/15 text-amber-500"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
