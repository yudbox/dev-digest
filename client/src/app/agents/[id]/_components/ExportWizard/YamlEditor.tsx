"use client";

import React, { useEffect, useRef } from "react";
import { EditorView, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    fontFamily: "var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace)",
    background: "#1a1a1a",
    color: "#e8e8e8",
  },
  ".cm-scroller": { overflow: "auto" },
  ".cm-content": { padding: "16px 0", color: "#e8e8e8", caretColor: "#fff" },
  ".cm-line": { padding: "0 18px", lineHeight: "1.7" },
  ".cm-gutters": {
    background: "#1a1a1a",
    border: "none",
    borderRight: "1px solid rgba(255,255,255,.08)",
    color: "rgba(255,255,255,.25)",
    minWidth: "42px",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 4px" },
  ".cm-activeLine": { background: "rgba(255,255,255,.04)" },
  ".cm-activeLineGutter": { background: "rgba(255,255,255,.04)" },
  ".cm-cursor": { borderLeftColor: "#fff", borderLeftWidth: "2px" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "#fff" },
  ".cm-selectionBackground": { background: "rgba(100,160,255,.25) !important" },
  "&.cm-focused .cm-selectionBackground": {
    background: "rgba(100,160,255,.3) !important",
  },
  // YAML key highlighting — very light, high contrast on dark background
  ".ͼ1 .tok-propertyName": { color: "#7dd3fc" },
  ".ͼ1 .tok-string": { color: "#e0f2fe" },
  ".ͼ1 .tok-comment": { color: "rgba(255,255,255,.4)", fontStyle: "italic" },
  ".ͼ1 .tok-number": { color: "#e8e8e8" },
  ".ͼ1 .tok-bool": { color: "#e8e8e8" },
});

export function YamlEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const onChangeListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        yaml(),
        syntaxHighlighting(
          HighlightStyle.define([
            { tag: tags.propertyName, color: "#7dd3fc" }, // keys: sky-300 (light blue)
            { tag: tags.string, color: "#e2e8f0" }, // strings: near-white
            { tag: tags.comment, color: "#b58304", fontStyle: "italic" }, // comments: amber
          ]),
        ),
        theme,
        onChangeListener,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only

  // Sync value from outside (e.g. first load) without triggering onChange
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        overflow: "hidden",
        background: "var(--bg-base)",
      }}
    />
  );
}
