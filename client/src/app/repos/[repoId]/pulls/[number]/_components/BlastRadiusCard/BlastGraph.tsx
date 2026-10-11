"use client";

import React, { useRef, useEffect } from "react";
import * as d3 from "d3";
import { useTranslations } from "next-intl";
import type { BlastRadiusResult } from "@devdigest/shared";

// ── Types ─────────────────────────────────────────────────────────────────────

export type GraphKind = "symbol" | "caller" | "endpoint" | "cron";

export interface GraphNode {
  id: string;
  kind: GraphKind;
  /** Main line: symbol name, enclosing caller symbol, endpoint or cron. */
  label: string;
  /** Second line (callers only): `file:line`. */
  detail?: string;
  /** Full text for the native tooltip. */
  title: string;
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
}

export interface LayeredGraph {
  /** Nodes per column, already ordered top to bottom. */
  columns: Record<GraphKind, GraphNode[]>;
  links: GraphLink[];
}

export const COLUMN_ORDER: GraphKind[] = ["symbol", "caller", "endpoint", "cron"];

// ── Build graph data ──────────────────────────────────────────────────────────

/**
 * Left-to-right impact graph: changed symbol → its callers → the endpoints
 * and crons declared in each caller's file (factsByFile is keyed by caller
 * file). Without factsByFile (older cached results) endpoints are still
 * shown, just unlinked — the data does not say which caller reaches them.
 */
export function buildLayeredGraph(data: BlastRadiusResult): LayeredGraph {
  const nodes = new Map<string, GraphNode>();
  const links = new Map<string, GraphLink>();

  const addNode = (node: GraphNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addLink = (source: string, target: string) => {
    const id = `${source}->${target}`;
    if (!links.has(id)) links.set(id, { id, source, target });
  };

  for (const sym of data.changedSymbols) {
    addNode({
      id: `sym:${sym.name}`,
      kind: "symbol",
      label: sym.name,
      title: `${sym.name} (${sym.kind}) — ${sym.file}`,
    });
  }

  for (const caller of data.callers) {
    const id = `caller:${caller.file}:${caller.line}`;
    const fileName = caller.file.split("/").pop() ?? caller.file;
    addNode({
      id,
      kind: "caller",
      label: caller.symbol,
      detail: `${fileName}:${caller.line}`,
      title: `${caller.symbol} — ${caller.file}:${caller.line}`,
    });
    const symId = `sym:${caller.viaSymbol}`;
    if (nodes.has(symId)) addLink(symId, id);

    const facts = data.factsByFile?.[caller.file];
    for (const ep of facts?.endpoints ?? []) {
      addNode({ id: `ep:${ep}`, kind: "endpoint", label: ep, title: ep });
      addLink(id, `ep:${ep}`);
    }
    for (const cron of facts?.crons ?? []) {
      addNode({ id: `cron:${cron}`, kind: "cron", label: cron, title: cron });
      addLink(id, `cron:${cron}`);
    }
  }

  for (const ep of data.impactedEndpoints) {
    addNode({ id: `ep:${ep}`, kind: "endpoint", label: ep, title: ep });
  }

  const linkList = [...links.values()];
  const byKind = (kind: GraphKind) =>
    [...nodes.values()].filter((n) => n.kind === kind);

  // Order each column by the average row of its parents (one barycenter
  // pass) so links run mostly straight instead of criss-crossing. Symbols
  // with callers come first; the ones nobody calls sink to the bottom.
  const parents = new Map<string, string[]>();
  for (const l of linkList) {
    parents.set(l.target, [...(parents.get(l.target) ?? []), l.source]);
  }
  const hasChildren = new Set(linkList.map((l) => l.source));
  const symbols = [
    ...byKind("symbol").filter((n) => hasChildren.has(n.id)),
    ...byKind("symbol").filter((n) => !hasChildren.has(n.id)),
  ];

  const orderByParents = (column: GraphNode[], parentColumn: GraphNode[]) => {
    const row = new Map(parentColumn.map((n, i) => [n.id, i]));
    const center = (n: GraphNode) => {
      const rows = (parents.get(n.id) ?? [])
        .map((p) => row.get(p))
        .filter((r): r is number => r !== undefined);
      return rows.length === 0
        ? Number.POSITIVE_INFINITY
        : rows.reduce((a, b) => a + b, 0) / rows.length;
    };
    return column
      .map((n, i) => ({ n, i, c: center(n) }))
      .sort((a, b) => a.c - b.c || a.i - b.i)
      .map((x) => x.n);
  };

  const callers = orderByParents(byKind("caller"), symbols);
  return {
    columns: {
      symbol: symbols,
      caller: callers,
      endpoint: orderByParents(byKind("endpoint"), callers),
      cron: orderByParents(byKind("cron"), callers),
    },
    links: linkList,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const KIND_COLOR: Record<GraphKind, string> = {
  symbol: "#818cf8",
  caller: "#64748b",
  endpoint: "#4ade80",
  cron: "#fbbf24",
};

const COLUMN_WIDTH: Record<GraphKind, number> = {
  symbol: 210,
  caller: 250,
  endpoint: 230,
  cron: 190,
};
const NODE_HEIGHT: Record<GraphKind, number> = {
  symbol: 32,
  caller: 44,
  endpoint: 32,
  cron: 32,
};
const COLUMN_GAP = 110;
// Same row pitch in every column, so a symbol with a single caller sits on
// the same row as it and their link is a straight line.
const ROW_PITCH = 56;
const HEADER_HEIGHT = 40;
const PADDING = 32;
const CHAR_WIDTH = 7.3; // 12px monospace
const LINK_COLOR = "#475569";

function truncate(text: string, width: number): string {
  const max = Math.floor((width - 24) / CHAR_WIDTH);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface BlastGraphProps {
  data: BlastRadiusResult;
  width: number;
  height: number;
}

interface Placed extends GraphNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function BlastGraph({ data, width, height }: BlastGraphProps) {
  const t = useTranslations("prReview.blastRadius");
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current!);
    svg.selectAll("*").remove();

    const { columns, links } = buildLayeredGraph(data);
    if (columns.symbol.length === 0) return;
    // Symbols and callers always get a column; endpoints and crons only
    // when the PR reaches any.
    const visible = COLUMN_ORDER.filter(
      (k) => k === "symbol" || k === "caller" || columns[k].length > 0,
    );

    // ── Layout: fixed columns; symbols stacked from the top, every other
    // node placed level with the average row of its parents (pushed down
    // only to avoid overlap), so a 1:1 link is a straight line and callers
    // of a symbol low in a long list sit next to it, not centered away. ──
    const parentsOf = new Map<string, string[]>();
    for (const l of links) {
      parentsOf.set(l.target, [...(parentsOf.get(l.target) ?? []), l.source]);
    }
    const top = PADDING + HEADER_HEIGHT;
    const rowTop = new Map<string, number>();
    const placed = new Map<string, Placed>();
    const columnX = new Map<GraphKind, number>();
    let x = PADDING;
    let bottom = top;
    for (const kind of visible) {
      columnX.set(kind, x);
      let next = top;
      for (const n of columns[kind]) {
        const parentRows = (parentsOf.get(n.id) ?? [])
          .map((p) => rowTop.get(p))
          .filter((r): r is number => r !== undefined);
        const wanted =
          kind === "symbol" || parentRows.length === 0
            ? next
            : parentRows.reduce((a, b) => a + b, 0) / parentRows.length;
        const y = Math.max(next, wanted);
        rowTop.set(n.id, y);
        placed.set(n.id, {
          ...n,
          x,
          y: y + (ROW_PITCH - NODE_HEIGHT[kind]) / 2,
          w: COLUMN_WIDTH[kind],
          h: NODE_HEIGHT[kind],
        });
        next = y + ROW_PITCH;
      }
      bottom = Math.max(bottom, next);
      x += COLUMN_WIDTH[kind] + COLUMN_GAP;
    }
    const contentWidth = x - COLUMN_GAP + PADDING;
    const totalHeight = bottom + PADDING;

    const g = svg.append("g");

    // ── Zoom / pan, starting fitted to the viewport ───────────────────────
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 3])
      .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr("transform", event.transform.toString());
      });
    svg.call(zoom);
    // Fit the width; a tall graph starts at the top and scrolls by panning
    // rather than shrinking the text to an unreadable size.
    const scale = Math.max(0.5, Math.min(1, width / contentWidth));
    svg.call(
      zoom.transform,
      d3.zoomIdentity
        .translate(
          Math.max(0, (width - contentWidth * scale) / 2),
          Math.max(0, (height - totalHeight * scale) / 2),
        )
        .scale(scale),
    );

    // ── Column headers ────────────────────────────────────────────────────
    const headerText: Record<GraphKind, string> = {
      symbol: t("symbols", { count: columns.symbol.length }),
      caller: t("callers", { count: columns.caller.length }),
      endpoint: t("endpoints", { count: columns.endpoint.length }),
      cron: t("crons", { count: columns.cron.length }),
    };
    g.append("g")
      .selectAll("text")
      .data(visible)
      .join("text")
      .attr("x", (k) => columnX.get(k)!)
      .attr("y", PADDING + 14)
      .attr("font-size", 11)
      .attr("letter-spacing", "0.6px")
      .attr("fill", (k) => KIND_COLOR[k])
      .style("text-transform", "uppercase")
      .text((k) => headerText[k]);

    // ── Links: smooth curves from a node's right edge to the next's left ─
    const linkPath = d3
      .linkHorizontal<{ s: [number, number]; t: [number, number] }, [number, number]>()
      .source((d) => d.s)
      .target((d) => d.t);

    const drawable = links.filter(
      (l) => placed.has(l.source) && placed.has(l.target),
    );
    const link = g
      .append("g")
      .attr("fill", "none")
      .selectAll<SVGPathElement, GraphLink>("path")
      .data(drawable)
      .join("path")
      .attr("stroke", LINK_COLOR)
      .attr("stroke-width", 1.5)
      .attr("d", (l) => {
        const s = placed.get(l.source)!;
        const tg = placed.get(l.target)!;
        return linkPath({
          s: [s.x + s.w, s.y + s.h / 2],
          t: [tg.x, tg.y + tg.h / 2],
        });
      });

    // ── Nodes ─────────────────────────────────────────────────────────────
    const node = g
      .append("g")
      .selectAll<SVGGElement, Placed>("g")
      .data([...placed.values()])
      .join("g")
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .style("cursor", "default");

    node.append("title").text((d) => d.title);

    node
      .append("rect")
      .attr("width", (d) => d.w)
      .attr("height", (d) => d.h)
      .attr("rx", 7)
      .attr("fill", "var(--bg-elevated, #1e2130)")
      .attr("stroke", (d) => KIND_COLOR[d.kind])
      .attr("stroke-width", (d) => (d.kind === "caller" ? 1 : 1.5));

    node
      .append("text")
      .attr("x", 12)
      .attr("y", (d) => (d.detail ? 18 : d.h / 2 + 4))
      .attr("font-family", "var(--font-mono, ui-monospace, monospace)")
      .attr("font-size", 12)
      .attr("font-weight", (d) => (d.kind === "symbol" ? 600 : 400))
      .attr("fill", "var(--text-primary, #e2e8f0)")
      .text((d) =>
        truncate(d.kind === "symbol" ? `${d.label}()` : d.label, d.w),
      );

    node
      .filter((d) => Boolean(d.detail))
      .append("text")
      .attr("x", 12)
      .attr("y", 34)
      .attr("font-family", "var(--font-mono, ui-monospace, monospace)")
      .attr("font-size", 11)
      .attr("fill", "var(--text-muted, #94a3b8)")
      .text((d) => truncate(d.detail!, d.w));

    // ── Hover: highlight the whole chain through a node, dim the rest ────
    const upstream = new Map<string, string[]>();
    const downstream = new Map<string, string[]>();
    for (const l of drawable) {
      downstream.set(l.source, [...(downstream.get(l.source) ?? []), l.target]);
      upstream.set(l.target, [...(upstream.get(l.target) ?? []), l.source]);
    }
    const walk = (
      start: string,
      edges: Map<string, string[]>,
      into: Set<string>,
    ) => {
      const stack = [start];
      while (stack.length > 0) {
        const id = stack.pop()!;
        for (const next of edges.get(id) ?? []) {
          if (!into.has(next)) {
            into.add(next);
            stack.push(next);
          }
        }
      }
    };

    node
      .on("mouseenter", (_event, d) => {
        const chain = new Set([d.id]);
        walk(d.id, downstream, chain);
        walk(d.id, upstream, chain);
        const inChain = (l: GraphLink) =>
          chain.has(l.source) && chain.has(l.target);
        node.attr("opacity", (n) => (chain.has(n.id) ? 1 : 0.2));
        link
          .attr("opacity", (l) => (inChain(l) ? 1 : 0.1))
          .attr("stroke", (l) => (inChain(l) ? KIND_COLOR.symbol : LINK_COLOR));
      })
      .on("mouseleave", () => {
        node.attr("opacity", 1);
        link.attr("opacity", 1).attr("stroke", LINK_COLOR);
      });
  }, [data, width, height, t]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="block rounded-md bg-[var(--bg-elevated,#1e2130)]"
    />
  );
}
