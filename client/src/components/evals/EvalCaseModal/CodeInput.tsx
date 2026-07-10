/* CodeInput — the "Code" tab for manually-written finding-grounded skill
   eval cases (`convention`/`security`/`custom`). Hides raw unified-diff
   syntax from the author: a New-file/Modified-file toggle plus Before/After
   textareas, with the actual diff (against the hidden `SNIPPET_FILE_PATH`)
   generated in `snippet-diff.ts` and surfaced via a collapsed "Preview
   generated diff" section. Controlled: emits the generated diff through
   `onChange` so the parent stores it as `input_diff`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs, Textarea, FormField, Icon } from "@devdigest/ui";
import {
  buildSnippetDiff,
  parseSnippetDiff,
  SNIPPET_FILE_PATH,
} from "./snippet-diff";

type CodeMode = "new" | "modified";

export function CodeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (diff: string) => void;
}) {
  const t = useTranslations("eval.caseEditor");

  // Prefill once from the parent's initial diff text (e.g. editing an
  // existing case); subsequent edits are driven purely by local state.
  const initial = React.useMemo(() => parseSnippetDiff(value), []);
  const [mode, setMode] = React.useState<CodeMode>(initial.mode);
  const [beforeText, setBeforeText] = React.useState(initial.before);
  const [afterText, setAfterText] = React.useState(initial.after);
  const [previewOpen, setPreviewOpen] = React.useState(false);

  const diff = React.useMemo(
    () =>
      buildSnippetDiff(
        mode === "new" ? "" : beforeText,
        afterText,
        SNIPPET_FILE_PATH,
      ),
    [mode, beforeText, afterText],
  );

  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  React.useEffect(() => {
    onChangeRef.current(diff);
  }, [diff]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Tabs
        tabs={[
          { key: "new", label: t("codeMode.newFile") },
          { key: "modified", label: t("codeMode.modifiedFile") },
        ]}
        value={mode}
        onChange={(k) => setMode(k as CodeMode)}
        pad="0"
      />

      {mode === "modified" && (
        <FormField label={t("codeBefore")}>
          <Textarea
            value={beforeText}
            onChange={setBeforeText}
            rows={6}
            mono
          />
        </FormField>
      )}

      <FormField label={t("codeAfter")}>
        <Textarea value={afterText} onChange={setAfterText} rows={6} mono />
      </FormField>

      <div>
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          {previewOpen ? (
            <Icon.ChevronDown size={12} />
          ) : (
            <Icon.ChevronRight size={12} />
          )}
          {t("previewGeneratedDiff")}
        </button>
        {previewOpen && (
          <pre
            className="mono"
            style={{
              marginTop: 8,
              padding: "10px 12px",
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: 200,
              overflow: "auto",
            }}
          >
            {diff}
          </pre>
        )}
      </div>
    </div>
  );
}
