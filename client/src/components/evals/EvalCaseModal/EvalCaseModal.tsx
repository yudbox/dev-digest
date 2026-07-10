/* EvalCaseModal — create/edit an eval case. Prefilled either blank ("New
   case") or from a `EvalCaseInput` returned by the "Turn into eval case"
   finding flow (AC-9). Shows a computed (not stored) POSITIVE/NEGATIVE
   banner derived from `expected_output.length` (AC-10).

   Owner-type branches (rubric-skill-eval-strategies plan, TASK-007):
   - `rubric` skill  → ONLY the PR-meta input tab (no Diff/Files/Code);
     "+ Dimension skeleton"; `RubricAssessment[]` JSON validation.
   - finding-grounded skill (`convention`/`security`/`custom`) → raw Diff tab
     replaced by the Code tab (`CodeInput`); no Files tab; "+ Finding
     skeleton" WITHOUT a `file` key (server injects the hidden path);
     `ExpectedFinding[]` validation with `file` optional.
   - agent-owned → unchanged (Diff/Files/PR-meta, file-bearing skeleton,
     `ExpectedFinding[]` with `file` required). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Modal, Button, Tabs, Icon } from "@devdigest/ui";
import { TextInput, Textarea, FormField } from "@devdigest/ui";
import type {
  EvalCase,
  EvalCaseInput,
  EvalOwnerKind,
  EvalRunRecord,
  SkillType,
} from "@devdigest/shared";
import {
  useCreateEvalCase,
  useUpdateEvalCase,
  useRunEvalCase,
} from "@/lib/hooks/evals";
import { CodeInput } from "./CodeInput";
import {
  caseTypeOf,
  tryParseExpectedOutput,
  getExpectedOutputError,
  stringifyExpectedOutput,
  skeletonFor,
  type ExpectedOutputKind,
} from "./helpers";

interface InputMeta {
  pr_title?: string;
  pr_body?: string;
}

function readInputMeta(meta: unknown): InputMeta {
  if (meta && typeof meta === "object") {
    const m = meta as Record<string, unknown>;
    return {
      pr_title: typeof m.pr_title === "string" ? m.pr_title : "",
      pr_body: typeof m.pr_body === "string" ? m.pr_body : "",
    };
  }
  return { pr_title: "", pr_body: "" };
}

type InputTabKey = "diff" | "files" | "prMeta" | "code";

export function EvalCaseModal({
  ownerKind,
  ownerId,
  skillType,
  initial,
  prefill,
  lastRun,
  onClose,
  onSaved,
}: {
  /** Required for a blank "New case" (EvalsTab already knows its owner).
   *  Optional when `initial`/`prefill` is given — the owner is then read off
   *  that record (the findings-prefill endpoint resolves it server-side). */
  ownerKind?: EvalOwnerKind;
  ownerId?: string;
  /** Set only when the owner is a skill — selects the rubric vs. finding-
   *  grounded UI branch. Agents never pass this. */
  skillType?: SkillType;
  /** Editing an existing persisted case. */
  initial?: EvalCase | null;
  /** Creating a new case, prefilled from "Turn into eval case" (AC-9). */
  prefill?: EvalCaseInput | null;
  /** The most recent persisted run for this case (if any) — seeds the
   *  read-only "Actual output" panel before "Run case" is clicked again. */
  lastRun?: EvalRunRecord | null;
  onClose: () => void;
  onSaved?: (c: EvalCase) => void;
}) {
  const t = useTranslations("eval.caseEditor");
  const tc = useTranslations("common");
  const router = useRouter();

  const source = initial ?? prefill ?? null;
  const initialMeta = readInputMeta(source?.input_meta);
  const resolvedOwnerKind =
    initial?.owner_kind ?? prefill?.owner_kind ?? ownerKind;
  const resolvedOwnerId = initial?.owner_id ?? prefill?.owner_id ?? ownerId;

  const isSkillOwner = resolvedOwnerKind === "skill";
  const expectedOutputKind: ExpectedOutputKind = !isSkillOwner
    ? "agentFinding"
    : skillType === "rubric"
      ? "rubric"
      : "skillFinding";
  const isRubricSkill = expectedOutputKind === "rubric";
  const isFindingGroundedSkill = expectedOutputKind === "skillFinding";

  const tabsList: { key: InputTabKey; label: string }[] = isRubricSkill
    ? []
    : isFindingGroundedSkill
      ? [
          { key: "code", label: t("tabs.code") },
          { key: "prMeta", label: t("tabs.prMeta") },
        ]
      : [
          { key: "diff", label: t("tabs.diff") },
          { key: "files", label: t("tabs.files") },
          { key: "prMeta", label: t("tabs.prMeta") },
        ];

  const [name, setName] = React.useState(
    (initial?.name ?? (prefill as EvalCaseInput | null)?.name) || "",
  );
  const [inputTab, setInputTab] = React.useState<InputTabKey>(
    isRubricSkill ? "prMeta" : isFindingGroundedSkill ? "code" : "diff",
  );
  const [diffText, setDiffText] = React.useState(source?.input_diff ?? "");
  const [filesText, setFilesText] = React.useState(
    source?.input_files ? JSON.stringify(source.input_files, null, 2) : "",
  );
  const [prTitle, setPrTitle] = React.useState(initialMeta.pr_title ?? "");
  const [prBody, setPrBody] = React.useState(initialMeta.pr_body ?? "");
  const [expectedText, setExpectedText] = React.useState(
    stringifyExpectedOutput(source?.expected_output),
  );
  const [notes] = React.useState(source?.notes ?? "");
  const [runOnSave, setRunOnSave] = React.useState(false);

  // Track the saved case id so "Run case" works even for a newly-created case
  const savedIdRef = React.useRef<string | null>(initial?.id ?? null);

  const parsedExpected = tryParseExpectedOutput(
    expectedText,
    expectedOutputKind,
  );
  const expectedOutputError = getExpectedOutputError(
    expectedText,
    expectedOutputKind,
  );
  const invalidJson = parsedExpected === null;
  const caseType = caseTypeOf(parsedExpected ?? []);

  const createCase = useCreateEvalCase();
  const updateCase = useUpdateEvalCase();
  const runCase = useRunEvalCase();

  const saving = createCase.isPending || updateCase.isPending;
  const isEditing = !!initial?.id;

  function buildInputMeta(): InputMeta | undefined {
    if (!prTitle && !prBody) return undefined;
    return { pr_title: prTitle || undefined, pr_body: prBody || undefined };
  }

  function handleSkeletonClick() {
    const skeleton = skeletonFor(expectedOutputKind);
    const parsed = tryParseExpectedOutput(expectedText, expectedOutputKind);
    if (!parsed || parsed.length === 0) {
      setExpectedText(JSON.stringify([skeleton], null, 2));
    } else {
      setExpectedText(JSON.stringify([...parsed, skeleton], null, 2));
    }
  }

  function handleRunCase() {
    const existingId = savedIdRef.current;
    if (existingId && resolvedOwnerKind && resolvedOwnerId) {
      runCase.mutate({
        id: existingId,
        ownerKind: resolvedOwnerKind,
        ownerId: resolvedOwnerId,
      });
      return;
    }
    if (!resolvedOwnerKind || !resolvedOwnerId || invalidJson || !name) return;
    createCase.mutate(
      {
        owner_kind: resolvedOwnerKind,
        owner_id: resolvedOwnerId,
        name,
        input_diff: diffText,
        input_meta: buildInputMeta(),
        expected_output: parsedExpected,
        notes: notes || undefined,
      },
      {
        onSuccess: (data) => {
          savedIdRef.current = data.id;
          runCase.mutate({
            id: data.id,
            ownerKind: resolvedOwnerKind!,
            ownerId: resolvedOwnerId!,
          });
        },
      },
    );
  }

  function handleSave() {
    if (invalidJson || !name) return;

    const afterSave = (data: EvalCase) => {
      savedIdRef.current = data.id;
      if (runOnSave && resolvedOwnerKind && resolvedOwnerId) {
        runCase.mutate(
          {
            id: data.id,
            ownerKind: resolvedOwnerKind,
            ownerId: resolvedOwnerId,
          },
          {
            onSuccess: () => {
              onSaved?.(data);
              onClose();
              const path =
                resolvedOwnerKind === "agent"
                  ? `/agents/${resolvedOwnerId}?tab=evals`
                  : `/skills/${resolvedOwnerId}?tab=evals`;
              router.push(path);
            },
          },
        );
      } else {
        onSaved?.(data);
        onClose();
      }
    };

    if (isEditing && initial) {
      updateCase.mutate(
        {
          id: initial.id,
          patch: {
            name,
            input_diff: diffText,
            input_meta: buildInputMeta(),
            expected_output: parsedExpected,
            notes: notes || undefined,
          },
        },
        { onSuccess: afterSave },
      );
    } else {
      if (!resolvedOwnerKind || !resolvedOwnerId) return;
      createCase.mutate(
        {
          owner_kind: resolvedOwnerKind,
          owner_id: resolvedOwnerId,
          name,
          input_diff: diffText,
          input_meta: buildInputMeta(),
          expected_output: parsedExpected,
          notes: notes || undefined,
        },
        { onSuccess: afterSave },
      );
    }
  }

  // Banner: derive file+title hint from first expected finding
  const firstExp =
    Array.isArray(parsedExpected) && parsedExpected.length > 0
      ? (parsedExpected[0] as {
          file?: string;
          start_line?: number;
          title?: string;
        })
      : null;

  // Inline run result
  const runResult = runCase.data?.result;
  const expectedCount = Array.isArray(parsedExpected)
    ? parsedExpected.length
    : 0;
  const runPassed = runResult
    ? runResult.traces_passed === runResult.traces_total
    : null;

  // Actual-output panel: the freshest run wins — the just-completed mutation
  // result if present, else the last persisted run passed in by the parent.
  // Refreshes in place (no reload) because `runCase.data` is reactive.
  const freshActual = runCase.data?.result.per_trace[0]?.actual;
  const actualOutputValue =
    freshActual !== undefined ? freshActual : lastRun?.actual_output;
  const hasActualOutput =
    actualOutputValue !== undefined && actualOutputValue !== null;
  const actualOutputText = hasActualOutput
    ? JSON.stringify(actualOutputValue, null, 2)
    : t("neverRunYet");

  const prMetaFields = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <FormField label={t("titleLabel")}>
        <TextInput
          value={prTitle}
          onChange={setPrTitle}
          placeholder={t("titlePlaceholder")}
        />
      </FormField>
      <FormField label={t("bodyLabel")}>
        <Textarea
          value={prBody}
          onChange={setPrBody}
          placeholder={t("bodyPlaceholder")}
          rows={6}
        />
      </FormField>
    </div>
  );

  return (
    <Modal
      width={960}
      title={isEditing ? t("caseTitle", { name: initial?.name }) : t("newCase")}
      subtitle={prefill ? t("seededFromFinding") : undefined}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* inline run result bar */}
          {runResult && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                borderRadius: 8,
                border: `1px solid ${runPassed ? "var(--ok)" : "var(--crit)"}`,
                background: runPassed
                  ? "color-mix(in srgb, var(--ok) 10%, transparent)"
                  : "color-mix(in srgb, var(--crit) 10%, transparent)",
              }}
            >
              {runPassed ? (
                <Icon.CheckCircle
                  size={14}
                  style={{ color: "var(--ok)", flexShrink: 0 }}
                />
              ) : (
                <Icon.XCircle
                  size={14}
                  style={{ color: "var(--crit)", flexShrink: 0 }}
                />
              )}
              <span
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  color: runPassed ? "var(--ok)" : "var(--crit)",
                }}
              >
                {runPassed ? t("lastRunPassed") : t("lastRunFailed")}
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
                ·
              </span>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {runResult.traces_passed}/{runResult.traces_total} passed
                {runResult.duration_ms != null &&
                  ` · ${(runResult.duration_ms / 1000).toFixed(1)}s`}
                {runResult.cost_usd != null &&
                  ` · $${runResult.cost_usd.toFixed(2)}`}
              </span>
            </div>
          )}

          {/* footer row */}
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* left: Run on save toggle */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                userSelect: "none",
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              {/* pill track */}
              <span
                style={{
                  position: "relative",
                  display: "inline-block",
                  width: 32,
                  height: 18,
                  borderRadius: 9,
                  background: runOnSave ? "var(--accent)" : "var(--border)",
                  transition: "background .15s",
                  flexShrink: 0,
                }}
              >
                {/* knob */}
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: runOnSave ? 14 : 2,
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "#fff",
                    transition: "left .15s",
                  }}
                />
                <input
                  type="checkbox"
                  checked={runOnSave}
                  onChange={(e) => setRunOnSave(e.target.checked)}
                  style={{
                    position: "absolute",
                    opacity: 0,
                    width: 0,
                    height: 0,
                  }}
                />
              </span>
              {t("runOnSave")}
            </label>

            {/* right: action buttons */}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <Button kind="ghost" size="sm" onClick={onClose}>
                {tc("actions.cancel")}
              </Button>
              <Button
                kind="secondary"
                size="sm"
                icon="Play"
                loading={runCase.isPending}
                disabled={invalidJson || !name}
                onClick={handleRunCase}
              >
                {runCase.isPending ? t("running") : t("runCase")}
              </Button>
              <Button
                kind="primary"
                size="sm"
                disabled={invalidJson || !name || saving}
                loading={saving}
                onClick={handleSave}
              >
                {saving ? t("saving") : t("save")}
              </Button>
            </div>
          </div>
        </div>
      }
    >
      {/* ── Two-column body ── */}
      <div style={{ display: "flex", minHeight: 460 }}>
        {/* LEFT: banner + name + input */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            borderRight: "1px solid var(--border)",
          }}
        >
          {/* POSITIVE / NEGATIVE banner card */}
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: `2px solid ${caseType === "must_find" ? "var(--accent)" : "var(--warn)"}`,
              background:
                caseType === "must_find"
                  ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                  : "color-mix(in srgb, var(--warn) 8%, transparent)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color:
                  caseType === "must_find" ? "var(--accent)" : "var(--warn)",
                marginBottom: 4,
              }}
            >
              {caseType === "must_find" ? "POSITIVE CASE" : "NEGATIVE CASE"}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                lineHeight: 1.4,
              }}
            >
              {caseType === "must_find" ? "MUST find" : "MUST NOT flag"}
              {firstExp?.title ? ` "${firstExp.title}"` : ""}
              {firstExp?.file
                ? ` at ${firstExp.file}${firstExp.start_line ? `:${firstExp.start_line}` : ""}`
                : ""}
            </div>
          </div>

          {/* Name */}
          <FormField label={t("nameLabel")} required>
            <TextInput
              value={name}
              onChange={setName}
              placeholder={t("namePlaceholder")}
            />
          </FormField>

          {/* Input */}
          <FormField label={t("inputLabel")}>
            {isRubricSkill ? (
              prMetaFields
            ) : (
              <>
                <Tabs
                  tabs={tabsList}
                  value={inputTab}
                  onChange={(k) => setInputTab(k as InputTabKey)}
                  pad="0"
                />
                <div style={{ marginTop: 12 }}>
                  {inputTab === "diff" && (
                    <Textarea
                      value={diffText}
                      onChange={setDiffText}
                      placeholder={t("diffPlaceholder")}
                      rows={12}
                      mono
                    />
                  )}
                  {inputTab === "code" && (
                    <CodeInput value={diffText} onChange={setDiffText} />
                  )}
                  {inputTab === "files" && (
                    <Textarea
                      value={filesText}
                      onChange={setFilesText}
                      placeholder={
                        '[{"path": "src/config.ts", "content": "..."}]'
                      }
                      rows={12}
                      mono
                    />
                  )}
                  {inputTab === "prMeta" && prMetaFields}
                </div>
              </>
            )}
          </FormField>
        </div>

        {/* RIGHT: expected output + actual output */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Header row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
              {t("expectedOutput")}
            </span>
            <span
              style={{
                fontSize: 11,
                color: invalidJson ? "var(--crit)" : "var(--ok)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {invalidJson ? (
                <Icon.XCircle size={12} />
              ) : (
                <Icon.CheckCircle size={12} />
              )}
              {expectedOutputError === "syntax"
                ? t("invalidJson")
                : expectedOutputError === "schema"
                  ? t("invalidSchema")
                  : t("validJson")}
            </span>
            <Button
              kind="ghost"
              size="sm"
              icon="Plus"
              onClick={handleSkeletonClick}
            >
              {isRubricSkill ? t("dimensionSkeleton") : t("findingSkeleton")}
            </Button>
          </div>

          <Textarea
            value={expectedText}
            onChange={setExpectedText}
            rows={10}
            mono
          />

          {/* Actual output — read-only, refreshes in place after "Run case".
              Plain side-by-side JSON, no automatic ✓/✗ annotation. */}
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {t("actualOutput")}
          </span>
          <textarea
            readOnly
            className="mono"
            rows={10}
            value={actualOutputText}
            style={{
              width: "100%",
              resize: "vertical",
              padding: "10px 12px",
              borderRadius: 7,
              border: "1px solid var(--border-strong)",
              background: "var(--bg-surface)",
              color: hasActualOutput
                ? "var(--text-primary)"
                : "var(--text-muted)",
              fontSize: 14,
              lineHeight: 1.55,
              outline: "none",
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
