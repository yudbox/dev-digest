"use client";

import React, { useRef, useEffect } from "react";
import * as d3 from "d3";
import type { SimulationNodeDatum, SimulationLinkDatum } from "d3";
import type { BlastRadiusResult } from "@devdigest/shared";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GraphNode extends SimulationNodeDatum {
  id: string;
  label: string;
  kind: "symbol" | "caller" | "endpoint";
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  linkId: string;
}

// ── Build graph data ──────────────────────────────────────────────────────────

export function buildGraphData(data: BlastRadiusResult): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeIds = new Set<string>();

  const addNode = (id: string, label: string, kind: GraphNode["kind"]) => {
    if (nodeIds.has(id)) return;
    nodeIds.add(id);
    nodes.push({ id, label, kind });
  };

  for (const sym of data.changedSymbols) {
    addNode(`sym:${sym.name}`, sym.name, "symbol");
  }

  for (const caller of data.callers) {
    const callerId = `caller:${caller.file}:${caller.line}`;
    const label = `${caller.file.split("/").pop() ?? caller.file}:${caller.line}`;
    addNode(callerId, label, "caller");
    const symId = `sym:${caller.viaSymbol}`;
    if (nodeIds.has(symId)) {
      links.push({
        linkId: `${symId}-${callerId}`,
        source: symId,
        target: callerId,
      });
    }
  }

  for (const ep of data.impactedEndpoints) {
    const epId = `ep:${ep}`;
    addNode(epId, ep, "endpoint");
    const firstSym = nodes.find((n) => n.kind === "symbol");
    if (firstSym) {
      links.push({
        linkId: `${firstSym.id}-${epId}`,
        source: firstSym.id,
        target: epId,
      });
    }
  }

  return { nodes, links };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_COLOR: Record<GraphNode["kind"], string> = {
  symbol: "#818cf8",
  caller: "#94a3b8",
  endpoint: "#4ade80",
};

const NODE_RADIUS: Record<GraphNode["kind"], number> = {
  symbol: 16,
  caller: 8,
  endpoint: 10,
};

// Concentric "blast radius" rings — distance from the changed symbol(s) at
// the center. Callers sit on the middle ring, endpoints on the outer ring,
// so the shape always reads as an impact radius regardless of how many
// disconnected components the data happens to produce.
const RING_LABEL: Record<GraphNode["kind"], string> = {
  symbol: "Changed",
  caller: "Callers",
  endpoint: "Endpoints",
};

// ── Component ─────────────────────────────────────────────────────────────────

interface BlastGraphProps {
  data: BlastRadiusResult;
  width: number;
  height: number;
}

export function BlastGraph({ data, width, height }: BlastGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current!);
    svg.selectAll("*").remove();

    const { nodes, links } = buildGraphData(data);
    if (nodes.length === 0) return;

    const g = svg.append("g");

    // Defs: glow filter + arrow marker
    const defs = g.append("defs");

    const filter = defs.append("filter").attr("id", "glow");
    filter
      .append("feGaussianBlur")
      .attr("stdDeviation", 4)
      .attr("result", "blur");
    const merge = filter.append("feMerge");
    merge.append("feMergeNode").attr("in", "blur");
    merge.append("feMergeNode").attr("in", "SourceGraphic");

    defs
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 20)
      .attr("refY", 5)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,0 L10,5 L0,10 Z")
      .attr("fill", "#7c85a3");

    // ── Concentric "blast radius" rings ─────────────────────────────────────
    // Center = changed symbol(s). Middle ring = callers. Outer ring =
    // impacted endpoints. Drawn first so nodes/links paint on top.
    const cx = width / 2;
    const cy = height / 2;
    const minDim = Math.min(width, height);
    const symbolCount = nodes.filter((n) => n.kind === "symbol").length;
    const ringRadius: Record<GraphNode["kind"], number> = {
      // Small non-zero radius so multiple changed symbols spread around a
      // tiny inner ring instead of collapsing on top of each other at a
      // single point. Capped well below the caller ring — with many changed
      // symbols (a big PR) they pack tighter via collision instead of the
      // ring itself growing past the container.
      symbol: Math.min(
        minDim * 0.16,
        Math.max(minDim * 0.08, NODE_RADIUS.symbol * symbolCount * 0.15),
      ),
      caller: minDim * 0.28,
      endpoint: minDim * 0.46,
    };

    const ringsLayer = g.append("g").attr("class", "rings");
    (["caller", "endpoint"] as const).forEach((kind) => {
      ringsLayer
        .append("circle")
        .attr("cx", cx)
        .attr("cy", cy)
        .attr("r", ringRadius[kind])
        .attr("fill", "none")
        .attr("stroke", "var(--border, #2d3149)")
        .attr("stroke-dasharray", "3,4")
        .attr("stroke-width", 1)
        .attr("opacity", 0.5);
      ringsLayer
        .append("text")
        .attr("x", cx)
        .attr("y", cy - ringRadius[kind] - 6)
        .attr("text-anchor", "middle")
        .attr("font-size", 9)
        .attr("letter-spacing", "0.5px")
        .attr("fill", "var(--text-muted, #6b7280)")
        .style("text-transform", "uppercase")
        .text(RING_LABEL[kind]);
    });

    // Zoom
    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 3])
        .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          g.attr("transform", event.transform.toString());
        }),
    );

    // ── Angular slot per node ────────────────────────────────────────────
    // Radius alone (forceRadial) fixes which RING a node sits on, but not
    // where on that ring — left to the simulation, that angle is near-
    // random, so a caller can land on the opposite side from its symbol
    // and its link line cuts across everyone else's. Instead: symbols get
    // an evenly-spaced angle around the circle, and each caller/endpoint
    // inherits its symbol's angle (fanned out a little if several share
    // one symbol) so links radiate outward like spokes instead of criss-
    // crossing.
    const symbolNodes = nodes.filter((n) => n.kind === "symbol");
    const nodeAngle = new Map<string, number>();
    symbolNodes.forEach((n, i) => {
      nodeAngle.set(n.id, (i / Math.max(symbolNodes.length, 1)) * 2 * Math.PI);
    });

    const endpointId = (end: string | number | GraphNode): string =>
      typeof end === "object" ? end.id : String(end);

    const childrenOfSymbol = new Map<string, GraphNode[]>();
    for (const link of links) {
      const sourceId = endpointId(link.source);
      const targetId = endpointId(link.target);
      const child = nodes.find((n) => n.id === targetId);
      if (!child || !nodeAngle.has(sourceId)) continue;
      const list = childrenOfSymbol.get(sourceId) ?? [];
      list.push(child);
      childrenOfSymbol.set(sourceId, list);
    }
    for (const [symbolId, children] of childrenOfSymbol) {
      const baseAngle = nodeAngle.get(symbolId)!;
      const spread = Math.min(0.5, 0.14 * children.length); // radians
      children.forEach((child, i) => {
        const offset =
          children.length === 1
            ? 0
            : spread * (i / (children.length - 1) - 0.5);
        nodeAngle.set(child.id, baseAngle + offset);
      });
    }

    const angleOf = (d: GraphNode) => nodeAngle.get(d.id) ?? 0;

    // Simulation — nodes are pulled to a fixed (radius, angle) slot by
    // kind so the shape reads as a blast radius (and links radiate outward
    // without crossing) even when many nodes have no direct link to each
    // other.
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(40)
          .strength(0.05),
      )
      .force("charge", d3.forceManyBody<GraphNode>().strength(-20))
      .force(
        "x",
        d3
          .forceX<GraphNode>((d) => cx + ringRadius[d.kind] * Math.cos(angleOf(d)))
          .strength((d) => (d.kind === "symbol" ? 0.9 : 0.35)),
      )
      .force(
        "y",
        d3
          .forceY<GraphNode>((d) => cy + ringRadius[d.kind] * Math.sin(angleOf(d)))
          .strength((d) => (d.kind === "symbol" ? 0.9 : 0.35)),
      )
      .force(
        "collision",
        d3.forceCollide<GraphNode>().radius((d) => NODE_RADIUS[d.kind] + 14),
      );

    // Links
    const link = g
      .append("g")
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", "#7c85a3")
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.85)
      .attr("marker-end", "url(#arrow)");

    // Tooltip
    const tooltip = g
      .append("g")
      .attr("class", "tooltip")
      .style("display", "none");
    const tooltipRect = tooltip
      .append("rect")
      .attr("rx", 4)
      .attr("ry", 4)
      .attr("fill", "rgba(0,0,0,0.8)")
      .attr("stroke", "var(--border, #2d3149)");
    const tooltipText = tooltip
      .append("text")
      .attr("fill", "#e2e8f0")
      .attr("font-size", 11)
      .attr("text-anchor", "middle");

    // Nodes
    const node = g
      .append("g")
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => NODE_RADIUS[d.kind])
      .attr("fill", (d) => NODE_COLOR[d.kind])
      .attr("fill-opacity", 0.85)
      .attr("stroke", (d) => (d.kind === "endpoint" ? "#4ade80" : "none"))
      .attr("stroke-width", (d) => (d.kind === "endpoint" ? 2 : 0))
      .attr("stroke-opacity", 0.5)
      .attr("filter", (d) => (d.kind === "symbol" ? "url(#glow)" : null))
      .attr("cursor", "grab")
      .on("mouseover", (event, d) => {
        const label = `${d.label} (${d.kind})`;
        tooltipText.text(label);
        const textNode = tooltipText.node() as SVGTextElement;
        const bbox = textNode.getBBox();
        tooltipRect
          .attr("x", bbox.x - 6)
          .attr("y", bbox.y - 4)
          .attr("width", bbox.width + 12)
          .attr("height", bbox.height + 8);
        tooltip
          .attr(
            "transform",
            `translate(${d.x ?? 0},${(d.y ?? 0) - NODE_RADIUS[d.kind] - 16})`,
          )
          .style("display", null);
      })
      .on("mouseout", () => {
        tooltip.style("display", "none");
      })
      .call(
        d3
          .drag<SVGCircleElement, GraphNode>()
          .on(
            "start",
            (
              event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>,
              d,
            ) => {
              if (!event.active) simulation.alphaTarget(0.3).restart();
              d.fx = d.x;
              d.fy = d.y;
            },
          )
          .on(
            "drag",
            (
              event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>,
              d,
            ) => {
              d.fx = event.x;
              d.fy = event.y;
            },
          )
          .on(
            "end",
            (
              event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>,
              d,
            ) => {
              if (!event.active) simulation.alphaTarget(0);
              d.fx = null;
              d.fy = null;
            },
          ),
      );

    // Labels — outlined in the card background color so crossing links/
    // arrows never make the text unreadable, regardless of what's under it.
    const label = g
      .append("g")
      .selectAll<SVGTextElement, GraphNode>("text")
      .data(nodes)
      .join("text")
      .attr("dy", (d) => NODE_RADIUS[d.kind] + 16)
      .attr("text-anchor", "middle")
      .attr("font-size", 13)
      .attr("font-weight", (d) => (d.kind === "symbol" ? 600 : 400))
      .attr("fill", "var(--text-primary, #e2e8f0)")
      .attr("paint-order", "stroke")
      .attr("stroke", "var(--bg-elevated, #1e2130)")
      .attr("stroke-width", 4)
      .attr("stroke-linejoin", "round")
      .style("pointer-events", "none")
      .style("user-select", "none")
      .text((d) =>
        d.label.length > 22 ? d.label.slice(0, 20) + "…" : d.label,
      );

    // Tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
        .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
        .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
        .attr("y2", (d) => (d.target as GraphNode).y ?? 0);
      node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
      label.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
    });

    return () => {
      simulation.stop();
    };
  }, [data, width, height]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="block rounded-md bg-[var(--bg-elevated,#1e2130)]"
    />
  );
}
