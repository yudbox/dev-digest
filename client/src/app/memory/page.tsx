"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Skeleton,
  EmptyState,
  Modal,
  FormField,
  SelectInput,
  Textarea,
} from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import {
  useMemory,
  useCreateMemory,
  useUpdateMemory,
  useDeleteMemory,
  useRefreshMemory,
} from "@/lib/hooks/memory";
import type {
  MemoryItemDto,
  MemoryListQuery,
  MemoryScope,
  MemoryKind,
  MemorySourceKind,
  MemoryCreateInput,
  MemoryUpdateInput,
} from "@devdigest/shared";
import { useRepos } from "@/lib/hooks";

const CRUMB = [{ label: "Memory" }];
const TD: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "middle",
};
const TH: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

function relativeTime(isoStr: string | null): string {
  if (!isoStr) return "–";
  const diff = Date.now() - new Date(isoStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  return `${days}d ago`;
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        padding: "6px 10px",
        fontSize: 13,
        color: "var(--text-primary)",
        cursor: "pointer",
        outline: "none",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function SourceBadge({ source }: { source: string }) {
  const isAuto = source === "auto";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 5,
        fontSize: 11,
        fontWeight: 600,
        background: isAuto ? "rgba(130,80,255,0.15)" : "rgba(50,180,100,0.12)",
        color: isAuto ? "var(--purple, #a78bfa)" : "var(--ok, #4ade80)",
      }}
    >
      {source}
    </span>
  );
}

function RowMenu({
  onEdit,
  onDelete,
  onProvenance,
}: {
  onEdit: () => void;
  onDelete: () => void;
  onProvenance: () => void;
}) {
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const dropRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!rect) return;
    const close = (e: MouseEvent) => {
      if (dropRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setRect(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [rect]);

  const actions = [
    {
      label: "Edit",
      fn: () => {
        setRect(null);
        onEdit();
      },
    },
    {
      label: "Provenance",
      fn: () => {
        setRect(null);
        onProvenance();
      },
    },
    {
      label: "Delete",
      fn: () => {
        setRect(null);
        onDelete();
      },
      danger: true,
    },
  ];

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={() =>
          setRect(rect ? null : btnRef.current!.getBoundingClientRect())
        }
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          fontSize: 18,
          lineHeight: 1,
          padding: "2px 6px",
          borderRadius: 5,
        }}
        onMouseOver={(e) =>
          ((e.currentTarget as HTMLElement).style.background =
            "var(--bg-hover)")
        }
        onMouseOut={(e) =>
          ((e.currentTarget as HTMLElement).style.background = "none")
        }
      >
        ···
      </button>
      {rect && (
        <div
          ref={dropRef}
          style={{
            position: "fixed",
            top: rect.bottom + 4,
            right: window.innerWidth - rect.right,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            padding: "4px 0",
            zIndex: 9999,
            minWidth: 148,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          {actions.map(({ label, fn, danger }) => (
            <button
              key={label}
              onClick={fn}
              style={{
                display: "block",
                width: "100%",
                padding: "8px 14px",
                background: "none",
                border: "none",
                textAlign: "left",
                fontSize: 13,
                cursor: "pointer",
                color: danger ? "var(--crit, #f87171)" : "var(--text-primary)",
              }}
              onMouseOver={(e) =>
                ((e.currentTarget as HTMLElement).style.background =
                  "var(--bg-hover)")
              }
              onMouseOut={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "none")
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MemoryModal({
  item,
  repos,
  onClose,
  onSave,
  saving,
}: {
  item?: MemoryItemDto;
  repos: { id: string; owner: string; name: string }[];
  onClose: () => void;
  onSave: (data: MemoryCreateInput | Partial<MemoryUpdateInput>) => void;
  saving: boolean;
}) {
  const isEdit = !!item;
  const [content, setContent] = React.useState(item?.content ?? "");
  const [kind, setKind] = React.useState<string>(item?.kind ?? "convention");
  const [scope, setScope] = React.useState<string>(item?.scope ?? "global");
  const [repoId, setRepoId] = React.useState<string>(item?.repoId ?? "");
  const [repoError, setRepoError] = React.useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    if (!isEdit && scope === "repo" && !repoId) {
      setRepoError(true);
      return;
    }
    setRepoError(false);
    if (isEdit) {
      onSave({ content: content.trim(), kind: kind as MemoryKind });
    } else {
      const body: MemoryCreateInput = {
        content: content.trim(),
        kind: kind as MemoryKind,
        scope: scope as MemoryScope,
        ...(scope === "repo" && repoId ? { repoId } : {}),
      };
      onSave(body);
    }
  };

  const footer = (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
      <Button kind="secondary" onClick={onClose} type="button">
        Cancel
      </Button>
      <Button kind="primary" type="submit" loading={saving} form="memory-form">
        Save
      </Button>
    </div>
  );

  return (
    <Modal
      width={480}
      title={isEdit ? "Edit memory rule" : "Add memory rule"}
      onClose={onClose}
      footer={footer}
    >
      <form id="memory-form" onSubmit={handleSubmit} style={{ padding: 24 }}>
        <FormField label="Content" required>
          <Textarea
            value={content}
            onChange={setContent}
            rows={3}
            placeholder="e.g. Ignore unused variable warnings in test files"
          />
        </FormField>
        <FormField label="Kind">
          <SelectInput
            value={kind}
            onChange={setKind}
            mono={false}
            options={[
              { value: "convention", label: "convention" },
              { value: "decision", label: "decision" },
              { value: "preference", label: "preference" },
              { value: "fact", label: "fact" },
              { value: "learning", label: "learning" },
            ]}
          />
        </FormField>
        {!isEdit && (
          <>
            <FormField label="Scope">
              <SelectInput
                value={scope}
                onChange={setScope}
                mono={false}
                options={[
                  { value: "global", label: "global — applies to all repos" },
                  { value: "repo", label: "repo — scoped to one repo" },
                ]}
              />
            </FormField>
            {scope === "repo" && (
              <FormField
                label="Repository"
                required
                hint={
                  repoError ? (
                    <span style={{ color: "var(--crit)" }}>
                      Select a repository
                    </span>
                  ) : undefined
                }
              >
                <SelectInput
                  value={repoId}
                  onChange={(v) => {
                    setRepoId(v);
                    setRepoError(false);
                  }}
                  mono={false}
                  options={[
                    { value: "", label: "— select repo —" },
                    ...repos.map((r) => ({
                      value: r.id,
                      label: `${r.owner}/${r.name}`,
                    })),
                  ]}
                />
              </FormField>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}

function ProvenanceModal({
  item,
  onClose,
}: {
  item: MemoryItemDto;
  onClose: () => void;
}) {
  const sources = item.sources as {
    findingIds?: string[];
    prNumbers?: number[];
  } | null;
  const text =
    item.source === "explicit"
      ? "Added by you manually."
      : `Distilled automatically from ${sources?.findingIds?.length ?? 0} dismissed finding(s).`;

  return (
    <Modal width={400} title="Provenance" onClose={onClose}>
      <div style={{ padding: 24 }}>
        <p
          style={{
            fontSize: 14,
            color: "var(--text-primary)",
            lineHeight: 1.6,
            marginBottom: 16,
          }}
        >
          {text}
        </p>
        {sources?.prNumbers && sources.prNumbers.length > 0 && (
          <div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
              }}
            >
              PULL REQUESTS
            </span>
            <p style={{ fontSize: 13, marginTop: 6 }}>
              {sources.prNumbers.map((n) => `#${n}`).join(", ")}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function MemoryTable({
  items,
  onEdit,
  onDelete,
  onProvenance,
}: {
  items: MemoryItemDto[];
  onEdit: (item: MemoryItemDto) => void;
  onDelete: (id: string) => void;
  onProvenance: (item: MemoryItemDto) => void;
}) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
      >
        <thead>
          <tr>
            <th style={{ ...TH, width: "42%" }}>CONTENT</th>
            <th style={TH}>KIND</th>
            <th style={TH}>SCOPE</th>
            <th style={TH}>SOURCE</th>
            <th style={{ ...TH, textAlign: "right" }}>CONF</th>
            <th style={TH}>USED</th>
            <th style={{ ...TH, width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr
              key={item.id}
              style={{
                borderBottom:
                  idx === items.length - 1 ? "none" : "1px solid var(--border)",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background =
                  "var(--bg-hover)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = "")
              }
            >
              <td style={TD}>
                <span
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    color: "var(--text-primary)",
                    lineHeight: 1.5,
                  }}
                >
                  {item.content}
                </span>
              </td>
              <td style={TD}>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 7px",
                    borderRadius: 5,
                    background: "var(--bg-hover)",
                    color: "var(--text-secondary)",
                    fontWeight: 500,
                  }}
                >
                  {item.kind}
                </span>
              </td>
              <td
                style={{ ...TD, color: "var(--text-secondary)", fontSize: 12 }}
              >
                {item.scopeLabel}
              </td>
              <td style={TD}>
                <SourceBadge source={item.source} />
              </td>
              <td
                style={{
                  ...TD,
                  textAlign: "right",
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              >
                {(item.confidence * 100).toFixed(0)}%
              </td>
              <td
                style={{
                  ...TD,
                  color: "var(--text-muted)",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                {relativeTime(item.lastUsedAt)}
              </td>
              <td style={TD}>
                <RowMenu
                  onEdit={() => onEdit(item)}
                  onDelete={() => onDelete(item.id)}
                  onProvenance={() => onProvenance(item)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MemoryPage() {
  const t = useTranslations("memory");
  const [scope, setScope] = React.useState("");
  const [kind, setKind] = React.useState("");
  const [source, setSource] = React.useState("");
  const [q, setQ] = React.useState("");

  const filters: Partial<MemoryListQuery> = {
    ...(scope ? { scope: scope as MemoryScope } : {}),
    ...(kind ? { kind: kind as MemoryKind } : {}),
    ...(source ? { source: source as MemorySourceKind } : {}),
    ...(q ? { q } : {}),
  };

  const { data, isLoading, isError, refetch } = useMemory(filters);
  const { data: repos = [] } = useRepos();
  const createMutation = useCreateMemory();
  const updateMutation = useUpdateMemory();
  const deleteMutation = useDeleteMemory();
  const refreshMutation = useRefreshMemory();

  const [addOpen, setAddOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<MemoryItemDto | null>(null);
  const [provenanceItem, setProvenanceItem] =
    React.useState<MemoryItemDto | null>(null);
  const [learnedMsg, setLearnedMsg] = React.useState<string | null>(null);

  const items = data?.items ?? [];

  async function handleRefresh() {
    try {
      const result = await refreshMutation.mutateAsync();
      if (result.learned > 0) {
        setLearnedMsg(t("page.learned", { count: result.learned }));
        setTimeout(() => setLearnedMsg(null), 4000);
      }
    } catch {
      /* surfaced via isError */
    }
  }

  return (
    <AppShell crumb={CRUMB}>
      {addOpen && (
        <MemoryModal
          repos={repos as { id: string; owner: string; name: string }[]}
          onClose={() => setAddOpen(false)}
          onSave={(body) =>
            createMutation.mutate(body as MemoryCreateInput, {
              onSuccess: () => setAddOpen(false),
            })
          }
          saving={createMutation.isPending}
        />
      )}
      {editItem && (
        <MemoryModal
          item={editItem}
          repos={repos as { id: string; owner: string; name: string }[]}
          onClose={() => setEditItem(null)}
          onSave={(patch) =>
            updateMutation.mutate(
              { id: editItem.id, patch: patch as Partial<MemoryUpdateInput> },
              { onSuccess: () => setEditItem(null) },
            )
          }
          saving={updateMutation.isPending}
        />
      )}
      {provenanceItem && (
        <ProvenanceModal
          item={provenanceItem}
          onClose={() => setProvenanceItem(null)}
        />
      )}

      <div
        style={{
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Memory</h1>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                margin: "4px 0 0",
              }}
            >
              {t("page.subtitle")}
            </p>
            {learnedMsg && (
              <p
                style={{ fontSize: 12, color: "var(--ok)", margin: "4px 0 0" }}
              >
                {learnedMsg}
              </p>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              loading={refreshMutation.isPending}
              onClick={handleRefresh}
            >
              Refresh
            </Button>
            <Button
              kind="primary"
              size="sm"
              icon="Plus"
              onClick={() => setAddOpen(true)}
            >
              Add memory
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <div
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search content…"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 7,
                padding: "6px 28px 6px 10px",
                fontSize: 13,
                color: "var(--text-primary)",
                outline: "none",
                minWidth: 200,
              }}
            />
            {q && (
              <button
                onClick={() => setQ("")}
                style={{
                  position: "absolute",
                  right: 7,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                }}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          <FilterSelect
            value={scope}
            onChange={setScope}
            options={[
              { value: "", label: "All scopes" },
              { value: "global", label: "global" },
              { value: "repo", label: "repo" },
              { value: "team", label: "team" },
            ]}
          />
          <FilterSelect
            value={kind}
            onChange={setKind}
            options={[
              { value: "", label: "All kinds" },
              { value: "convention", label: "convention" },
              { value: "decision", label: "decision" },
              { value: "preference", label: "preference" },
              { value: "fact", label: "fact" },
              { value: "learning", label: "learning" },
            ]}
          />
          <FilterSelect
            value={source}
            onChange={setSource}
            options={[
              { value: "", label: "All sources" },
              { value: "explicit", label: "explicit" },
              { value: "auto", label: "auto" },
            ]}
          />
        </div>

        {/* Loading */}
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} height={44} />
            ))}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div
            style={{
              fontSize: 13,
              color: "var(--crit)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {t("page.loadError")}
            <button
              onClick={() => refetch()}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                fontSize: 13,
                padding: 0,
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && items.length === 0 && (
          <EmptyState
            icon="Brain"
            title={t("page.emptyTitle")}
            body={t("page.emptyBody")}
            cta="Add memory"
            onCta={() => setAddOpen(true)}
          />
        )}

        {/* Table */}
        {items.length > 0 && (
          <MemoryTable
            items={items}
            onEdit={setEditItem}
            onDelete={(id) => deleteMutation.mutate(id)}
            onProvenance={setProvenanceItem}
          />
        )}
      </div>
    </AppShell>
  );
}
