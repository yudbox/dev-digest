"use client";
// DEBUG_VERSION_20260720_v4
import React from "react";
import { parse as parseYaml } from "yaml";
import { Modal, Button, Checkbox, Icon } from "@devdigest/ui";
import { ExportWizardSteps } from "@/vendor/ui/ExportWizardSteps";
import type { CiFile, CiExportInputBody, CiExport } from "@devdigest/shared";
import { useExportCi } from "@/lib/hooks/ci";
import { API_BASE } from "@/lib/api";
import { useActiveRepo } from "@/lib/contexts/repoContext";
import { YamlEditor } from "./YamlEditor";

// ── Types ──────────────────────────────────────────────────────────────────

type Step = 0 | 1 | 2 | 3;
type PostAs = "github_review" | "pr_comment" | "none";

interface WizardState {
  repo: string;
  triggers: { opened: boolean; synchronize: boolean; reopened: boolean };
  postAs: PostAs;
  editedYaml: string | null; // null = use server value
}

// ── Constants ──────────────────────────────────────────────────────────────

const STEP_LABELS = ["Target", "Preview", "Configure", "Install"];

const POST_AS_OPTIONS: {
  value: PostAs;
  label: string;
  description: string;
  hint: string;
  recommended?: boolean;
}[] = [
  {
    value: "github_review",
    label: "GitHub review",
    description: "Posts a formal review (APPROVE / REQUEST_CHANGES / COMMENT).",
    hint: "Only this mode can block a merge via branch protection. Combine with \u201cFail CI on\u201d in the CI tab.",
    recommended: true,
  },
  {
    value: "pr_comment",
    label: "PR comment",
    description: "Posts a plain PR comment with findings.",
    hint: "Won't block merges — the check exits green even if there are critical findings.",
  },
  {
    value: "none",
    label: "None (exit code only)",
    description: "Does not post anything; exit code signals pass/fail.",
    hint: "Silent mode. Useful when another tool posts the results, or when you only want the check status.",
  },
];

// ── Security lints ──────────────────────────────────────────────────────────

interface YamlWarning {
  message: string;
  severity: "error" | "warn";
}

function lintWorkflowYaml(content: string): YamlWarning[] {
  const warnings: YamlWarning[] = [];

  // Hard-block: syntax check
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "YAML syntax error";
    warnings.push({ message: msg, severity: "error" });
    return warnings;
  }

  const doc = parsed as Record<string, unknown>;

  // Soft-warn: pull_request_target (security risk — exposes secrets to fork PRs)
  // Only flag non-comment lines that actually use pull_request_target as a YAML key
  const nonCommentLines = content
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"));
  if (nonCommentLines.some((l) => l.includes("pull_request_target"))) {
    warnings.push({
      message:
        "pull_request_target is unsafe — exposes GITHUB_TOKEN to fork PRs. Use pull_request instead.",
      severity: "warn",
    });
  }

  // Soft-warn: permissions check
  const jobs = doc?.jobs as Record<string, unknown> | undefined;
  if (jobs) {
    for (const [, job] of Object.entries(jobs)) {
      const j = job as Record<string, unknown>;
      const perms = j?.permissions as Record<string, unknown> | undefined;
      if (perms) {
        const contents = perms["contents"];
        const prs = perms["pull-requests"];
        if (contents && contents !== "read") {
          warnings.push({
            message: `permissions.contents should be "read", got "${contents}".`,
            severity: "warn",
          });
        }
        if (prs && prs !== "write") {
          warnings.push({
            message: `permissions.pull-requests should be "write", got "${prs}".`,
            severity: "warn",
          });
        }
      }
    }
  }

  // Soft-warn: hardcoded secrets (naive: check for obvious patterns)
  const secretPattern =
    /(?:api[_-]?key|token|password|secret)\s*[:=]\s*['"][^'"]{8,}/i;
  if (secretPattern.test(content)) {
    warnings.push({
      message:
        "Possible hardcoded secret detected. Use ${{ secrets.* }} instead of inlining credentials.",
      severity: "warn",
    });
  }

  return warnings;
}

// ── Step 1: Target ─────────────────────────────────────────────────────────

type CiTarget = "gha" | "circle" | "jenkins" | "cli";

const TARGET_CARDS: {
  value: CiTarget;
  label: string;
  description: string;
  disabled?: boolean;
}[] = [
  {
    value: "gha",
    label: "GitHub Actions",
    description: "Runs on pull_request events",
  },
  {
    value: "circle",
    label: "CircleCI",
    description: "config.yml job",
    disabled: true,
  },
  {
    value: "jenkins",
    label: "Jenkins",
    description: "Pipeline stage",
    disabled: true,
  },
  {
    value: "cli",
    label: "Generic CLI",
    description: "devdigest review --pr",
    disabled: true,
  },
];

function TargetStep({
  repo,
  onRepoChange,
}: {
  repo: string;
  onRepoChange: (r: string) => void;
}) {
  const { repos } = useActiveRepo();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginBottom: 8,
          }}
        >
          Target repository
        </div>
        {repos.length > 0 ? (
          <select
            value={repo}
            onChange={(e) => onRepoChange(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 7,
              border: "1px solid var(--border-strong)",
              background: "var(--bg-surface)",
              fontSize: 13,
              color: "var(--text-primary)",
              outline: "none",
              boxSizing: "border-box" as const,
              cursor: "pointer",
            }}
          >
            {repos.map((r) => (
              <option key={r.id} value={r.full_name}>
                {r.full_name}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={repo}
            onChange={(e) => onRepoChange(e.target.value)}
            placeholder="acme/payments-api"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 7,
              border: "1px solid var(--border-strong)",
              background: "var(--bg-surface)",
              fontSize: 13,
              color: "var(--text-primary)",
              outline: "none",
              boxSizing: "border-box" as const,
            }}
          />
        )}
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
          {repos.length > 0
            ? "Select the repo to add the workflow to"
            : "owner/name — the repo to add the workflow to"}
        </div>
      </div>

      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginBottom: 12,
          }}
        >
          CI target
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          {TARGET_CARDS.map((card) => (
            <div
              key={card.value}
              title={card.disabled ? "Coming soon" : undefined}
              style={{
                padding: "16px 18px",
                borderRadius: 10,
                border:
                  card.value === "gha"
                    ? "2px solid var(--accent)"
                    : "1px solid var(--border)",
                background: card.disabled
                  ? "var(--bg-base)"
                  : card.value === "gha"
                    ? "var(--accent-bg)"
                    : "var(--bg-surface)",
                opacity: card.disabled ? 0.45 : 1,
                cursor: card.disabled ? "not-allowed" : "default",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: card.disabled
                      ? "var(--text-muted)"
                      : "var(--text-primary)",
                  }}
                >
                  {card.label}
                </span>
                {card.value === "gha" && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "var(--accent)",
                      color: "#fff",
                      letterSpacing: "0.05em",
                    }}
                  >
                    RECOMMENDED
                  </span>
                )}
                {card.disabled && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "var(--bg-hover)",
                      color: "var(--text-muted)",
                    }}
                  >
                    COMING SOON
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {card.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Preview ─────────────────────────────────────────────────────────

function PreviewStep({
  files,
  editedYaml,
  onEditYaml,
  yamlWarnings,
}: {
  files: CiFile[];
  editedYaml: string | null;
  onEditYaml: (v: string) => void;
  yamlWarnings: YamlWarning[];
}) {
  const [selectedPath, setSelectedPath] = React.useState<string>("");

  // Update selectedPath when files load — default to editable file (workflow.yml)
  React.useEffect(() => {
    if (files.length === 0) return;
    setSelectedPath((prev) => {
      if (prev && files.find((f) => f.path === prev)) return prev;
      return files.find((f) => f.editable)?.path ?? files[0]?.path ?? "";
    });
  }, [files]);

  const selected = files.find((f) => f.path === selectedPath);
  const isWorkflow = selected?.editable === true;

  const content = isWorkflow
    ? (editedYaml ?? selected?.contents ?? "")
    : (selected?.contents ?? "");

  return (
    <div
      style={{
        display: "flex",
        height: 440,
        gap: 0,
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* File list */}
      <div
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--bg-base)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 16px",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.07em",
            color: "var(--text-muted)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          FILES TO CREATE
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {files.map((f) => {
            const isEditable = f.editable === true;
            const isActive = f.path === selectedPath;
            return (
              <div
                key={f.path}
                onClick={() => {
                  setSelectedPath(f.path);
                }}
                style={{
                  padding: "8px 16px",
                  fontSize: 12,
                  cursor: "pointer",
                  background: isActive ? "var(--bg-elevated)" : "transparent",
                  color: isActive
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                  borderLeft: isActive
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span className="mono" style={{ wordBreak: "break-all" }}>
                  {f.path}
                </span>
                {isEditable && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "var(--accent)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <Icon.Edit size={9} />
                    editable
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {/* File header — path + editable badge */}
        <div
          style={{
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--bg-surface)",
            flexShrink: 0,
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 12, color: "var(--text-secondary)" }}
          >
            {selectedPath}
          </span>
          {isWorkflow && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--accent)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 4,
                border: "1px solid var(--accent)",
                background: "var(--accent-bg)",
              }}
            >
              <Icon.Edit size={10} />
              editable
            </span>
          )}
        </div>

        {/* Warnings */}
        {isWorkflow && yamlWarnings.length > 0 && (
          <div
            style={{
              padding: "8px 14px",
              background: yamlWarnings.some((w) => w.severity === "error")
                ? "var(--crit-bg, rgba(239,68,68,.1))"
                : "rgba(245,158,11,.08)",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {yamlWarnings.map((w, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 6,
                  fontSize: 12,
                  color: w.severity === "error" ? "var(--crit)" : "var(--warn)",
                }}
              >
                {w.severity === "error" ? (
                  <Icon.AlertOctagon
                    size={13}
                    style={{ flexShrink: 0, marginTop: 1 }}
                  />
                ) : (
                  <Icon.AlertTriangle
                    size={13}
                    style={{ flexShrink: 0, marginTop: 1 }}
                  />
                )}
                {w.message}
              </div>
            ))}
          </div>
        )}

        {/* Editor / viewer */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {isWorkflow ? (
            <YamlEditor value={content} onChange={onEditYaml} />
          ) : (
            <pre
              style={{
                margin: 0,
                padding: "14px 18px",
                fontSize: 12,
                fontFamily: "var(--font-mono, monospace)",
                color: "var(--text-secondary)",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Configure ───────────────────────────────────────────────────────

function ConfigureStep({
  triggers,
  postAs,
  onTriggersChange,
  onPostAsChange,
}: {
  triggers: WizardState["triggers"];
  postAs: PostAs;
  onTriggersChange: (t: WizardState["triggers"]) => void;
  onPostAsChange: (v: PostAs) => void;
}) {
  const selectedOption = POST_AS_OPTIONS.find((o) => o.value === postAs)!;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Triggers */}
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginBottom: 12,
          }}
        >
          Trigger on pull request events
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Checkbox
            checked={triggers.opened}
            onChange={(v) => onTriggersChange({ ...triggers, opened: v })}
            label={
              <span style={{ fontSize: 13 }}>
                opened{" "}
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  — review when a PR is opened
                </span>
              </span>
            }
          />
          <Checkbox
            checked={triggers.synchronize}
            onChange={(v) => onTriggersChange({ ...triggers, synchronize: v })}
            label={
              <span style={{ fontSize: 13 }}>
                synchronize{" "}
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  — re-review after new commits
                </span>
              </span>
            }
          />
          <Checkbox
            checked={triggers.reopened}
            onChange={(v) => onTriggersChange({ ...triggers, reopened: v })}
            label={
              <span style={{ fontSize: 13 }}>
                reopened{" "}
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  — review when a PR is reopened
                </span>
              </span>
            }
          />
        </div>
      </div>

      {/* Post results as */}
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
            marginBottom: 12,
          }}
        >
          Post results as
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {POST_AS_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 8,
                border:
                  postAs === opt.value
                    ? "1.5px solid var(--accent)"
                    : "1px solid var(--border)",
                background:
                  postAs === opt.value
                    ? "var(--accent-bg)"
                    : "var(--bg-surface)",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="postAs"
                value={opt.value}
                checked={postAs === opt.value}
                onChange={() => onPostAsChange(opt.value)}
                style={{ marginTop: 2, accentColor: "var(--accent)" }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                    }}
                  >
                    {opt.label}
                  </span>
                  {opt.recommended && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: "var(--accent)",
                        color: "#fff",
                      }}
                    >
                      RECOMMENDED
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    marginTop: 2,
                  }}
                >
                  {opt.description}
                </div>
              </div>
            </label>
          ))}
        </div>

        {/* Dynamic hint */}
        <div
          style={{
            marginTop: 10,
            padding: "10px 14px",
            borderRadius: 8,
            background: "var(--bg-base)",
            border: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--text-secondary)",
            lineHeight: 1.55,
          }}
        >
          <Icon.Info
            size={12}
            style={{
              display: "inline",
              marginRight: 5,
              color: "var(--accent)",
            }}
          />
          {selectedOption.hint}
        </div>
      </div>

      {/* Block-merge instructions */}
      <div
        style={{
          padding: "12px 14px",
          borderRadius: 8,
          background: "rgba(245,158,11,.06)",
          border: "1px solid rgba(245,158,11,.2)",
          fontSize: 12,
          color: "var(--text-secondary)",
          lineHeight: 1.55,
        }}
      >
        <strong
          style={{ color: "var(--warn)", display: "block", marginBottom: 4 }}
        >
          To block merges on findings:
        </strong>
        Set <em>Post results as</em> → GitHub review, <em>Fail CI on</em> (CI
        tab) → Critical or Warning+, then add a{" "}
        <strong>required status check</strong> in GitHub branch protection
        (Settings → Branches → Require status checks). No GitHub App needed.
      </div>
    </div>
  );
}

// ── Step 4: Install ─────────────────────────────────────────────────────────

export type InstallAction = "open_pr" | "files";

function InstallStep({
  repo,
  selected,
  onSelect,
  fileCount,
  prResult,
}: {
  repo: string;
  selected: InstallAction;
  onSelect: (a: InstallAction) => void;
  fileCount: number;
  prResult: CiExport | null;
}) {
  if (prResult) {
    return (
      <div
        style={{
          padding: "24px 20px",
          borderRadius: 10,
          background: "var(--ok-bg)",
          border: "1px solid var(--ok)",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <Icon.CheckCircle
          size={20}
          style={{ color: "var(--ok)", flexShrink: 0, marginTop: 1 }}
        />
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--ok)",
              marginBottom: 4,
            }}
          >
            {prResult.pr_url ? "Pull request opened" : "Files ready"}
          </div>
          {prResult.pr_url && (
            <a
              href={prResult.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 13,
                color: "var(--accent)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Icon.ExternalLink size={13} />
              View pull request
            </a>
          )}
        </div>
      </div>
    );
  }

  const cards: {
    action: InstallAction;
    icon: string;
    title: string;
    badge?: string;
    desc: string;
  }[] = [
    {
      action: "open_pr",
      icon: "GitBranch",
      title: "Open a PR with these files",
      badge: "recommended",
      desc: `DevDigest opens a PR in ${repo || "owner/repo"} titled \"Add DevDigest CI review\" with ${fileCount} generated files.`,
    },
    {
      action: "files",
      icon: "Copy",
      title: "Copy files as a zip",
      desc: "Download the same files as a zip archive. Unzip into repo root, commit, and open a PR yourself.",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {cards.map((card) => {
        const isActive = selected === card.action;
        const CardIcon = Icon[card.icon as keyof typeof Icon] as React.FC<{
          size?: number;
          style?: React.CSSProperties;
        }>;
        return (
          <div
            key={card.action}
            onClick={() => onSelect(card.action)}
            style={{
              padding: "18px 20px",
              borderRadius: 10,
              border: isActive
                ? "1.5px solid var(--accent)"
                : "1px solid var(--border)",
              background: isActive ? "var(--accent-bg)" : "var(--bg-surface)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 14,
              transition: "border-color .15s, background .15s",
            }}
          >
            <CardIcon
              size={18}
              style={{
                color: isActive ? "var(--accent)" : "var(--text-muted)",
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  {card.title}
                </span>
                {card.badge && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "var(--accent)",
                      color: "#fff",
                    }}
                  >
                    {card.badge}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginTop: 3,
                }}
              >
                {card.desc}
              </div>
            </div>
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 99,
                border: isActive
                  ? "5px solid var(--accent)"
                  : "1.5px solid var(--border-strong)",
                flexShrink: 0,
                background: isActive ? "#fff" : "transparent",
                boxSizing: "border-box",
              }}
            />
          </div>
        );
      })}

      {/* Help link */}
      <div style={{ fontSize: 12, color: "var(--text-muted)", paddingTop: 4 }}>
        <Icon.Info size={12} style={{ display: "inline", marginRight: 5 }} />
        Need help?{" "}
        <a
          href="https://docs.github.com/en/actions"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)" }}
        >
          See the GitHub Actions setup docs →
        </a>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function ExportWizard({
  agentId,
  agentName,
  onClose,
}: {
  agentId: string;
  agentName?: string;
  onClose: () => void;
}) {
  const { activeRepo } = useActiveRepo();
  const [step, setStep] = React.useState<Step>(0);
  const [state, setState] = React.useState<WizardState>({
    repo: activeRepo?.full_name ?? "",
    triggers: { opened: true, synchronize: true, reopened: false },
    postAs: "github_review",
    editedYaml: null,
  });

  // Sync repo when activeRepo loads (if state.repo is still empty)
  React.useEffect(() => {
    if (!state.repo && activeRepo?.full_name) {
      setState((s) => ({ ...s, repo: activeRepo.full_name }));
    }
  }, [activeRepo?.full_name, state.repo]);

  const exportCi = useExportCi(agentId);
  const [previewFiles, setPreviewFiles] = React.useState<CiFile[] | null>(null);
  const [loadingPreview, setLoadingPreview] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CiExport | null>(null);
  const [installAction, setInstallAction] =
    React.useState<InstallAction>("open_pr");

  const yamlWarnings = React.useMemo(() => {
    if (!previewFiles) return [];
    const wf = previewFiles.find((f) => f.path.endsWith("workflow.yml"));
    const content = state.editedYaml ?? wf?.contents ?? "";
    if (!content) return [];
    return lintWorkflowYaml(content);
  }, [previewFiles, state.editedYaml]);

  const hasHardError = yamlWarnings.some((w) => w.severity === "error");

  async function loadPreview() {
    if (previewFiles) return;
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const r = await exportCi.mutateAsync({
        repo: state.repo,
        target: "gha",
        action: "preview",
        post_as: state.postAs,
        triggers: Object.entries(state.triggers)
          .filter(([, v]) => v)
          .map(([k]) => k),
      });
      setPreviewFiles(r.files);
    } catch (e: unknown) {
      setPreviewError(
        e instanceof Error ? e.message : "Failed to generate preview",
      );
    } finally {
      setLoadingPreview(false);
    }
  }

  function handleNext() {
    if (step === 0) {
      // Load preview when moving to step 1
      void loadPreview();
      setStep(1);
    } else if (step < 3) {
      setStep((step + 1) as Step);
    }
  }

  function handleBack() {
    if (step > 0) setStep((step - 1) as Step);
  }

  const canContinue = (): boolean => {
    if (step === 0) return state.repo.trim().length > 0;
    if (step === 1) return !hasHardError && !loadingPreview && !!previewFiles;
    return true;
  };

  const isLastStep = step === 3;

  return (
    <Modal
      width={840}
      title={`Export to CI${agentName ? ` — ${agentName}` : ""}`}
      subtitle="Run this agent automatically on every pull request"
      onClose={onClose}
      footer={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Button
            kind="ghost"
            size="sm"
            onClick={handleBack}
            disabled={step === 0}
          >
            Back
          </Button>
          {!isLastStep && (
            <Button
              kind="primary"
              size="sm"
              onClick={handleNext}
              disabled={!canContinue()}
              loading={loadingPreview}
            >
              Continue
            </Button>
          )}
          {isLastStep && !result && (
            <Button
              kind="primary"
              size="sm"
              icon={installAction === "open_pr" ? "Check" : "Upload"}
              loading={exportCi.isPending}
              disabled={exportCi.isPending || !state.repo}
              onClick={async () => {
                const body: CiExportInputBody = {
                  repo: state.repo,
                  target: "gha",
                  action: installAction,
                  post_as: state.postAs,
                  triggers: Object.entries(state.triggers)
                    .filter(([, v]) => v)
                    .map(([k]) => k),
                };
                try {
                  if (installAction === "files") {
                    // ZIP download — must use blob(), not json()
                    const res = await fetch(
                      `${API_BASE}/agents/${agentId}/export-ci`,
                      {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify(body),
                      },
                    );
                    if (!res.ok) throw new Error(await res.text());
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "devdigest-ci.zip";
                    a.click();
                    URL.revokeObjectURL(url);
                  } else {
                    const r = await exportCi.mutateAsync(body);
                    setResult(r);
                  }
                } catch (err) {
                  console.error("[ExportWizard] Install failed:", err);
                  // error is surfaced via exportCi.error — shown in UI below
                }
              }}
            >
              {installAction === "open_pr" ? "Install" : "Download zip"}
            </Button>
          )}
        </div>
      }
    >
      <div
        style={{
          padding: "20px 24px 0",
          borderBottom: "1px solid var(--border)",
          paddingBottom: 20,
        }}
      >
        <ExportWizardSteps step={step} labels={STEP_LABELS} />
      </div>
      <div style={{ padding: "24px", overflow: "auto", flex: 1 }}>
        {/* Install error banner */}
        {exportCi.error && step === 3 && (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 16px",
              borderRadius: 8,
              background: "var(--crit-bg, rgba(239,68,68,.1))",
              border: "1px solid var(--crit)",
              fontSize: 13,
              color: "var(--crit)",
            }}
          >
            <strong>Install failed:</strong>{" "}
            {exportCi.error instanceof Error
              ? exportCi.error.message
              : String(exportCi.error)}
          </div>
        )}
        {step === 0 && (
          <TargetStep
            repo={state.repo}
            onRepoChange={(repo) => setState((s) => ({ ...s, repo }))}
          />
        )}
        {step === 1 && (
          <>
            {loadingPreview && (
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: 13,
                  padding: "20px 0",
                }}
              >
                Generating files…
              </div>
            )}
            {previewError && (
              <div
                style={{
                  color: "var(--crit)",
                  fontSize: 13,
                  padding: "20px 0",
                }}
              >
                {previewError}
              </div>
            )}
            {previewFiles && (
              <PreviewStep
                files={previewFiles}
                editedYaml={state.editedYaml}
                onEditYaml={(v) => setState((s) => ({ ...s, editedYaml: v }))}
                yamlWarnings={yamlWarnings}
              />
            )}
          </>
        )}
        {step === 2 && (
          <ConfigureStep
            triggers={state.triggers}
            postAs={state.postAs}
            onTriggersChange={(triggers) =>
              setState((s) => ({ ...s, triggers }))
            }
            onPostAsChange={(postAs) => setState((s) => ({ ...s, postAs }))}
          />
        )}
        {step === 3 && (
          <InstallStep
            repo={state.repo}
            selected={installAction}
            onSelect={setInstallAction}
            fileCount={previewFiles?.length ?? 0}
            prResult={result}
          />
        )}
        {result && step !== 3 && null}
      </div>
    </Modal>
  );
}
