"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton, EmptyState, ErrorState, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/contexts";
import { useOnboarding, useRegenerateOnboarding } from "@/lib/hooks/onboarding";
import { AccordionSection } from "./_components/AccordionSection";
import { ScrollSpyNav } from "./_components/ScrollSpyNav";
import { OnboardingHeader } from "./_components/OnboardingHeader";
import { ArchitectureSectionView } from "./_components/ArchitectureSection";
import { CriticalPathsSection } from "./_components/CriticalPathsSection";
import { HowToRunSection } from "./_components/HowToRunSection";
import { ReadingPathSection } from "./_components/ReadingPathSection";
import { FirstTasksSection } from "./_components/FirstTasksSection";

/**
 * /repos/:repoId/onboarding — Onboarding Tour page.
 * 5-section collapsible accordion with sticky scroll-spy nav.
 */
export default function OnboardingPage() {
  const t = useTranslations("onboarding");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;

  const { activeRepo } = useActiveRepo();
  const repoLabel = activeRepo?.full_name ?? repoId;

  const crumb = [
    { label: repoLabel, mono: true },
    { label: t("page.breadcrumb") },
  ];

  const { data, isLoading, isError, refetch } = useOnboarding(repoId);
  const regenerateMutation = useRegenerateOnboarding(repoId);

  const navSections = [
    { id: "section-architecture", label: t("sections.architecture") },
    { id: "section-criticalPaths", label: t("sections.criticalPaths") },
    { id: "section-howToRun", label: t("sections.howToRun") },
    { id: "section-readingPath", label: t("sections.readingPath") },
    { id: "section-firstTasks", label: t("sections.firstTasks") },
  ];

  function handleRegenerate() {
    regenerateMutation.mutate();
  }

  // Onboarding data can resolve before the repos list has (repo metadata is
  // needed for the Critical Paths / Reading Path "Open" links), so section
  // rendering waits on both.
  const ready = data && activeRepo;

  return (
    <AppShell crumb={crumb}>
      {(isLoading || (!!data && !activeRepo)) && (
        <div style={{ padding: "20px 20px 44px", maxWidth: 1400, margin: "0 auto" }}>
          <Skeleton height={32} style={{ marginBottom: 12 }} />
          <Skeleton height={24} style={{ marginBottom: 24 }} />
          <Skeleton height={200} style={{ marginBottom: 12 }} />
          <Skeleton height={200} />
        </div>
      )}

      {isError && <ErrorState title={t("error.title")} onRetry={() => refetch()} />}

      {!isLoading && !isError && !data && (
        <EmptyState
          title={t("empty.title")}
          body={t("empty.body")}
          cta={
            regenerateMutation.isPending
              ? t("header.regenerating")
              : t("empty.cta")
          }
          onCta={handleRegenerate}
          ctaLoading={regenerateMutation.isPending}
        />
      )}

      {ready && (
        <>
          <OnboardingHeader
            onboarding={data}
            onRegenerate={handleRegenerate}
            isRegenerating={regenerateMutation.isPending}
          />

          <div
            style={{
              display: "flex",
              gap: 20,
              alignItems: "flex-start",
              padding: "20px 20px 44px",
              maxWidth: 1400,
              margin: "0 auto",
            }}
          >
            <ScrollSpyNav sections={navSections} title={t("nav.onThisPage")} />

            <div style={{ flex: 1, minWidth: 0 }}>
              <AccordionSection
                id="section-architecture"
                title={t("sections.architecture")}
                icon={<Icon.Layers size={17} />}
              >
                <ArchitectureSectionView section={data.sections.architecture} />
              </AccordionSection>

              <AccordionSection
                id="section-criticalPaths"
                title={t("sections.criticalPaths")}
                icon={<Icon.Target size={17} />}
              >
                <CriticalPathsSection
                  items={data.sections.criticalPaths}
                  repo={activeRepo}
                  defaultBranch={activeRepo.default_branch}
                />
              </AccordionSection>

              <AccordionSection
                id="section-howToRun"
                title={t("sections.howToRun")}
                icon={<Icon.Play size={17} />}
              >
                <HowToRunSection section={data.sections.howToRun} />
              </AccordionSection>

              <AccordionSection
                id="section-readingPath"
                title={t("sections.readingPath")}
                icon={<Icon.Workflow size={17} />}
              >
                <ReadingPathSection
                  items={data.sections.readingPath}
                  repo={activeRepo}
                  defaultBranch={activeRepo.default_branch}
                />
              </AccordionSection>

              <AccordionSection
                id="section-firstTasks"
                title={t("sections.firstTasks")}
                icon={<Icon.ListChecks size={17} />}
              >
                <FirstTasksSection tasks={data.sections.firstTasks} />
              </AccordionSection>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
