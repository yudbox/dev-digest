"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, SearchableSelect, Icon } from "@devdigest/ui";
import {
  useFeatureModels,
  useUpdateSettings,
} from "../../../../../../../lib/hooks";
import { useProviderModels } from "../../../../../../../lib/hooks/agents";
import { toModelOptions } from "../../../../../../../lib/utils/modelLabel";
import type {
  FeatureModelId,
  ResolvedFeatureModel,
} from "../../../../../../../lib/types";
import { SectionTitle } from "../SectionTitle";
import { s } from "./styles";

/**
 * Settings → Feature Models. One picker per system LLM feature.
 *
 * All values (defaults and overrides) are fetched from the server via
 * GET /settings/feature-models — no hardcoded defaults on the client.
 * The model list + prices come LIVE from OpenRouter (useProviderModels).
 */
export function SettingsModels() {
  const t = useTranslations("settings");
  const { data: featureModels } = useFeatureModels();
  const update = useUpdateSettings();
  const { data: models } = useProviderModels("openrouter");

  const baseOptions = toModelOptions(models);
  const noModels = models !== undefined && models.length === 0;

  const setModel = (feature: ResolvedFeatureModel, model: string) => {
    // Build the full overrides object: keep existing non-default overrides, set the new one.
    const existingOverrides = Object.fromEntries(
      (featureModels ?? [])
        .filter((f) => !f.isDefault)
        .map((f) => [f.id, { provider: f.provider, model: f.model }]),
    );
    update.mutate({
      feature_models: {
        ...existingOverrides,
        [feature.id]: { provider: "openrouter", model },
      },
    });
  };

  return (
    <div style={s.wrap}>
      <SectionTitle title={t("models.title")} body={t("models.body")} />

      {(featureModels ?? []).map((f) => {
        const options = baseOptions.some(
          (o) => (typeof o === "string" ? o : o.value) === f.model,
        )
          ? baseOptions
          : [f.model, ...baseOptions];
        return (
          <div key={f.id} style={s.row}>
            <FormField
              label={
                <>
                  {f.label}
                  {f.isDefault && (
                    <span style={s.defaultTag}>{t("models.usingDefault")}</span>
                  )}
                </>
              }
              hint={f.description}
            >
              <SearchableSelect
                value={f.model}
                onChange={(m) => setModel(f, m)}
                options={options}
                placeholder={t("models.search")}
              />
            </FormField>
          </div>
        );
      })}

      <div style={s.note}>
        <Icon.Info size={15} style={s.noteIcon} />
        <span>{noModels ? t("models.noKeyNote") : t("models.liveNote")}</span>
      </div>
    </div>
  );
}
