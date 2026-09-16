"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ReadingPathItem } from "@devdigest/shared";
import { vcsBlobUrl, type VcsUrlRepo } from "@/lib/utils/vcsUrls";

interface Props {
  items: ReadingPathItem[];
  repo: VcsUrlRepo;
  defaultBranch: string;
}

export function ReadingPathSection({ items, repo, defaultBranch }: Props) {
  const t = useTranslations("onboarding.readingPath");
  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {items.map((item) => (
        <li
          key={item.file}
          style={{
            borderBottom: "1px solid var(--border)",
            padding: "12px 0",
            display: "flex",
            gap: 14,
            alignItems: "flex-start",
          }}
        >
          <span
            style={{
              flexShrink: 0,
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "var(--accent)",
              color: "var(--bg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            {item.order}
          </span>
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
              {item.reason}
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
    </ol>
  );
}

export default ReadingPathSection;
