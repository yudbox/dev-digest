/* FilterBar — search box, status chips, sort select, and refresh for the PR list. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, Button, TextInput, SelectInput } from "@devdigest/ui";
import type { RepoSyncStatus } from "@/lib/hooks";
import { STATUS_FILTERS } from "../../constants";
import { s } from "../../styles";

/** Which "last synced" bucket to show — day-level under a month, then
 *  month-level up to a year, then just "over a year ago" forever after
 *  (SPEC: exact days while fresh, coarser the staler it gets, capped). */
function syncedAgoParts(
  lastPolledAt: string | null,
): { key: "syncedToday" | "syncedDaysAgo" | "syncedMonthsAgo" | "syncedOverYearAgo" | "neverSynced"; count?: number } {
  if (!lastPolledAt) return { key: "neverSynced" };
  const days = Math.floor((Date.now() - new Date(lastPolledAt).getTime()) / 86_400_000);
  if (days <= 0) return { key: "syncedToday" };
  if (days < 30) return { key: "syncedDaysAgo", count: days };
  const months = Math.floor(days / 30);
  if (months >= 12) return { key: "syncedOverYearAgo" };
  return { key: "syncedMonthsAgo", count: months };
}

export function FilterBar({
  active,
  onActive,
  query,
  onQuery,
  sort,
  onSort,
  onRefresh,
  refreshing,
  syncStatus,
}: {
  active: string;
  onActive: (k: string) => void;
  query: string;
  onQuery: (v: string) => void;
  sort: string;
  onSort: (v: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** `undefined` while the once-a-day staleness check hasn't resolved yet. */
  syncStatus?: RepoSyncStatus | null;
}) {
  const t = useTranslations("prReview");
  const agoParts = syncStatus ? syncedAgoParts(syncStatus.last_polled_at) : null;
  const sortOptions = [
    { value: "newest", label: t("list.sort.newest") },
    { value: "oldest", label: t("list.sort.oldest") },
  ];
  return (
    <div style={s.filterBar}>
      <div style={s.filterChips}>
        <div style={{ width: 240 }}>
          <TextInput value={query} onChange={onQuery} placeholder={t("list.filterPlaceholder")} />
        </div>
        {STATUS_FILTERS.map(({ key, labelKey }) => (
          <Chip key={key} active={active === key} onClick={() => onActive(key)}>
            {t(`list.filter.${labelKey}`)}
          </Chip>
        ))}
      </div>
      <div style={s.filterActions}>
        {syncStatus && agoParts && (
          <span style={s.syncStatus} title={syncStatus.last_polled_at ?? undefined}>
            {syncStatus.commits_behind ? (
              <span style={s.syncStatusBehind}>
                {t("list.syncStatus.behind", { count: syncStatus.commits_behind })}
              </span>
            ) : (
              <span style={s.syncStatusOk}>{t("list.syncStatus.upToDate")}</span>
            )}
            {" · "}
            {agoParts.count !== undefined
              ? t(`list.syncStatus.${agoParts.key}`, { count: agoParts.count })
              : t(`list.syncStatus.${agoParts.key}`)}
          </span>
        )}
        <SelectInput value={sort} onChange={onSort} options={sortOptions} mono={false} />
        <Button
          kind="secondary"
          size="sm"
          icon="RefreshCw"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? t("list.refreshing") : t("list.refresh")}
        </Button>
      </div>
    </div>
  );
}
