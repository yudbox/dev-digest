"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { CriticalPathItem } from "@devdigest/shared";
import { vcsBlobUrl, type VcsUrlRepo } from "@/lib/utils/vcsUrls";

interface Props {
  items: CriticalPathItem[];
  repo: VcsUrlRepo;
  defaultBranch: string;
}

export function CriticalPathsSection({ items, repo, defaultBranch }: Props) {
  const t = useTranslations("onboarding.criticalPaths");
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {items.map((item) => (
        <li
          key={item.file}
          style={{
            borderBottom: "1px solid var(--border)",
            padding: "12px 0",
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: 1 }}>
            <code
              style={{
                fontSize: 12,
                background: "var(--bg-elevated)",
                padding: "2px 6px",
                borderRadius: 4,
                color: "var(--accent)",
              }}
            >
              {item.file}
            </code>
            <p
              style={{
                margin: "6px 0 0",
                color: "var(--text-secondary)",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {item.whyItMatters}
            </p>
          </div>
          <a
            href={vcsBlobUrl(repo, defaultBranch, item.file, undefined, undefined, "branch")}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              textDecoration: "none",
              flexShrink: 0,
              padding: "2px 8px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              whiteSpace: "nowrap",
            }}
          >
            {t("openFile")}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default CriticalPathsSection;
