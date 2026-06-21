"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/contexts/repoContext";
import { useConventions, useExtractConventions } from "@/lib/hooks/conventions";
import { ConventionCard } from "../ConventionCard/ConventionCard";
import { CreateSkillFromConventionsModal } from "../CreateSkillFromConventionsModal/CreateSkillFromConventionsModal";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const { repoId, activeRepo } = useActiveRepo();
  const {
    data: conventions = [],
    isLoading,
    isError,
    refetch,
  } = useConventions(repoId);
  const extract = useExtractConventions();
  const [showModal, setShowModal] = React.useState(false);

  const accepted = conventions.filter((c) => c.accepted);
  const total = conventions.length;

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumb") }];

  return (
    <AppShell crumb={crumb}>
      {showModal && repoId && (
        <CreateSkillFromConventionsModal
          repoId={repoId}
          repoName={activeRepo?.name ?? "repo"}
          acceptedCount={accepted.length}
          onClose={() => setShowModal(false)}
          onCreated={() => setShowModal(false)}
        />
      )}

      <div style={{ padding: 28, maxWidth: 860 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
              {t("page.heading")}{" "}
              <span style={{ color: "var(--accent)" }}>
                {activeRepo?.name ?? "—"}
              </span>
            </h1>
            {total > 0 && (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {t("page.acceptedCount", { count: accepted.length, total })}
              </p>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Button
              kind="secondary"
              icon="RefreshCw"
              onClick={() => repoId && extract.mutate(repoId)}
              loading={extract.isPending}
            >
              {t("page.rescan")}
            </Button>
            {accepted.length > 0 && (
              <Button
                kind="primary"
                icon="Sparkles"
                onClick={() => setShowModal(true)}
              >
                {t("page.createSkill")}
              </Button>
            )}
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        ) : isError ? (
          <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />
        ) : total === 0 && !extract.isPending ? (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => repoId && extract.mutate(repoId)}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {extract.isPending && (
              <div
                style={{
                  padding: 16,
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: 13,
                }}
              >
                {t("page.scanning")}
              </div>
            )}
            {conventions.map((c) => (
              <ConventionCard
                key={c.id}
                convention={c}
                repoId={repoId!}
                repoUrl={
                  activeRepo
                    ? `https://github.com/${activeRepo.full_name}`
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
