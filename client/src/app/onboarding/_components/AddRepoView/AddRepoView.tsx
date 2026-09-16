/* AddRepoView — add-repository screen body. URL only, plus (TASK-010) a
   provider picker that only appears when the URL's host can't be
   auto-detected. API keys (OpenAI / Anthropic / GitHub PAT / Azure DevOps
   PAT) are NOT entered here; they live in Settings → API Keys and don't
   change per repo. Escapable: Esc or the close button returns to the app. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, Icon, IconBtn, Kbd, TextInput, FormField, SelectInput } from "@devdigest/ui";
import { useAddRepo } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import type { VcsProvider } from "@/lib/types";

/**
 * Best-effort, client-side-only mirror of the server's `parseRepoUrl` host
 * detection (`server/src/modules/repos/helpers.ts`) — used ONLY to drive the
 * pre-submit "detected: GitHub / Azure DevOps" indicator. The server remains
 * the sole source of truth: an unrecognized host there throws
 * `provider_required`, which is what actually reveals the manual picker
 * below (this client-side guess is just a head start / UI nicety).
 */
function detectProviderHint(url: string): VcsProvider | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/github\.com/i.test(trimmed)) return "github";
  if (/dev\.azure\.com|\.visualstudio\.com/i.test(trimmed)) return "azure-devops";
  return null;
}

const PROVIDER_LABEL: Record<VcsProvider, string> = {
  github: "GitHub",
  "azure-devops": "Azure DevOps",
};

export function AddRepoView() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  // Manual picker only shows once auto-detection has definitively failed —
  // either client-side (host doesn't match any known pattern) or, more
  // authoritatively, when the server itself rejects the URL with
  // `provider_required` on submit.
  const [showManualPicker, setShowManualPicker] = React.useState(false);
  const [manualProvider, setManualProvider] = React.useState<VcsProvider>("azure-devops");
  const [baseUrl, setBaseUrl] = React.useState("");
  const addRepo = useAddRepo();

  const detected = detectProviderHint(repoUrl);

  React.useEffect(() => {
    // Once the URL has real content and still doesn't auto-detect, offer the
    // manual picker proactively — don't make the user submit first to find out.
    if (repoUrl.trim() && !detected) setShowManualPicker(true);
    else if (!repoUrl.trim()) setShowManualPicker(false);
  }, [repoUrl, detected]);

  const close = React.useCallback(() => router.push("/"), [router]);

  // Escapable (the footer advertises Esc — make it real).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const submit = async () => {
    if (!repoUrl.trim()) return;
    setError(null);
    try {
      const repo = await addRepo.mutateAsync({
        url: repoUrl.trim(),
        ...(showManualPicker
          ? {
              vcs_provider: manualProvider,
              ...(manualProvider === "azure-devops" && baseUrl.trim()
                ? { base_url: baseUrl.trim() }
                : {}),
            }
          : {}),
      });
      router.push(`/repos/${repo.id}/pulls`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "provider_required") {
        setShowManualPicker(true);
        setError("Couldn't auto-detect a provider for this URL — pick one below.");
        return;
      }
      setError(e instanceof ApiError ? e.message : "Could not add repository");
    }
  };

  const needsBaseUrl = showManualPicker && manualProvider === "azure-devops";

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: "var(--bg-primary)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "44px 28px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--text-primary)", display: "grid", placeItems: "center" }}>
          <Icon.Layers size={17} style={{ color: "var(--bg-primary)" }} />
        </div>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>DevDigest</span>
      </div>

      <div
        style={{
          position: "relative",
          width: 520,
          maxWidth: "100%",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 36,
          boxShadow: "var(--shadow-modal)",
        }}
      >
        <div style={{ position: "absolute", top: 16, right: 16 }}>
          <IconBtn icon="X" label="Close" onClick={close} />
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Add a repository</h1>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 8, marginBottom: 28, lineHeight: 1.5 }}>
          Paste a GitHub or Azure DevOps repository URL — DevDigest clones it locally and imports open PRs.
          API keys aren’t needed here; set them once in{" "}
          <a
            href="/settings/api-keys"
            onClick={(e) => {
              e.preventDefault();
              router.push("/settings/api-keys");
            }}
            style={{ color: "var(--accent-text)" }}
          >
            Settings → API Keys
          </a>
          .
        </p>

        <FormField
          label="Repository URL"
          hint={
            detected
              ? `Detected: ${PROVIDER_LABEL[detected]}`
              : "e.g. https://github.com/acme/payments-api or https://dev.azure.com/org/project/_git/repo"
          }
        >
          <TextInput
            value={repoUrl}
            onChange={setRepoUrl}
            mono
            placeholder="https://github.com/owner/repo or https://dev.azure.com/org/project/_git/repo"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !needsBaseUrl) submit();
            }}
          />
        </FormField>

        {showManualPicker && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
            <FormField label="Provider" hint="Couldn't auto-detect this host — select the provider manually.">
              <SelectInput
                value={manualProvider}
                onChange={(v) => setManualProvider(v as VcsProvider)}
                options={[
                  { value: "github", label: "GitHub" },
                  { value: "azure-devops", label: "Azure DevOps" },
                ]}
              />
            </FormField>
            {needsBaseUrl && (
              <FormField label="Base URL" hint="Required for self-hosted Azure DevOps Server (e.g. https://ado.acme.internal/tfs).">
                <TextInput
                  value={baseUrl}
                  onChange={setBaseUrl}
                  mono
                  placeholder="https://dev.azure.com"
                />
              </FormField>
            )}
          </div>
        )}

        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 8,
              background: "var(--crit-bg)",
              border: "1px solid rgba(239,68,68,0.25)",
              marginTop: 16,
            }}
          >
            <Icon.XCircle size={16} style={{ color: "var(--crit)" }} />
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{error}</span>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 24 }}>
          <Button kind="ghost" size="md" onClick={close}>
            Cancel
          </Button>
          <div style={{ flex: 1 }} />
          <Button
            kind="primary"
            size="md"
            icon="Plus"
            onClick={submit}
            disabled={!repoUrl.trim() || addRepo.isPending}
          >
            {addRepo.isPending ? "Cloning…" : "Add repository"}
          </Button>
        </div>
      </div>

      <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 24, display: "inline-flex", gap: 8, alignItems: "center" }}>
        <Icon.Lock size={12} /> API keys live in Settings · <Kbd>esc</Kbd> to close
      </p>
    </div>
  );
}
