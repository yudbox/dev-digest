"use client";

import React from "react";
import { Button } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { notify } from "@/lib/contexts/toast";
import { useSyncCi } from "@/lib/hooks/performance";

/**
 * "Sync CI": pulls fresh CI runs on an explicit click (existing CI import —
 * GitHub API, no model call), then the stats on screen refresh. Opening or
 * reloading a screen never does this. A failure is already toasted by the
 * global mutation handler and the data on screen is left as it was, so this
 * button must not toast it a second time.
 */
export function SyncCiButton() {
  const t = useTranslations("stats.syncCi");
  const sync = useSyncCi();
  return (
    <Button
      kind="secondary"
      size="sm"
      icon="RefreshCw"
      loading={sync.isPending}
      disabled={sync.isPending}
      onClick={() =>
        sync.mutate(undefined, {
          onSuccess: (result) => notify.success(t("success", { count: result.ingested })),
        })
      }
    >
      {sync.isPending ? t("syncing") : t("label")}
    </Button>
  );
}
