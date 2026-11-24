"use client";

// LLMTELEMET-292 (T-21 RUN C2): the Flow SVG view. The layout, curved links,
// node sizes and tooltip copy follow flow.js:631-720 and flow.js:950-973.
// Every colour is a CSS token; every node mark is a provider SVG path.
import { useMemo, useState } from "react";

import type { AnalyticsRow } from "../../lib/home-board/types";
import {
  flowChats,
  flowColor,
  flowData,
  flowFlatten,
  flowNodeMark,
  short,
  type FlowDepth,
  type FlowLink,
  type FlowNode,
} from "../../lib/life-flow/flow";
import "../../styles/life-flow-graph.css";
import FlowTip from "./FlowTip";

const W = 1100;
const H = 560;

interface Layout {
  nodes: FlowNode[];
  links: FlowLink[];
  maxCalls: number;
  radius: (node: FlowNode) => number;
}

/** flow.js:641-735 — concentric seeds, a short force relaxation, then fit.
 * Pure maths so the same rows always produce the same layout. */
function layout(root: FlowNode): Layout {
  const { nodes, links } = flowFlatten(root);
  const maxCalls = Math.max(...nodes.map((node) => node.calls), 1);
  const radius = (node: FlowNode): number => node.kind === "root"
    ? 26
    : Math.max(4, Math.sqrt(node.calls / maxCalls) *
        (node.kind === "prov" ? 30 : node.kind === "model" ? 22 : 14));
  const cx = W / 2;
  const cy = H / 2;
  const span = Math.min(W, H) / 2 - 40;
  const ring: Record<number, number> = { 0: 0, 1: span * 0.34, 2: span * 0.66, 3: span * 0.95 };
  const byDepth = new Map<number, FlowNode[]>();
  nodes.forEach((node) => {
    const list = byDepth.get(node.depth ?? 0) ?? [];
    list.push(node);
    byDepth.set(node.depth ?? 0, list);
  });
  for (const [depth, list] of byDepth) {
    list.forEach((node, index) => {
      const angle = (index / list.length) * Math.PI * 2 + depth * 0.6;
      node.x = cx + Math.cos(angle) * ring[depth];
      node.y = cy + Math.sin(angle) * ring[depth];
      node.vx = 0;
      node.vy = 0;
    });
  }
  root.x = cx;
  root.y = cy;

  const nodesWithVelocity = nodes as Array<FlowNode & { vx: number; vy: number }>;
  const linkLength = (depth: number): number =>
    depth === 1 ? span * 0.34 : depth === 2 ? span * 0.32 : span * 0.26;
  const step = (): void => {
    for (let i = 0; i < nodesWithVelocity.length; i++) {
      const a = nodesWithVelocity[i];
      for (let j = i + 1; j < nodesWithVelocity.length; j++) {
        const b = nodesWithVelocity[j];
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const d2 = dx * dx + dy * dy || 0.01;
        const minD = radius(a) + radius(b) + 14;
        const force = (d2 < minD * minD ? span * span * 0.1015 : span * span * 0.035) / d2;
        const d = Math.sqrt(d2);
        a.vx -= (dx / d) * force * 0.01;
        a.vy -= (dy / d) * force * 0.01;
        b.vx += (dx / d) * force * 0.01;
        b.vy += (dy / d) * force * 0.01;
      }
    }
    for (const link of links) {
      const a = link.s as FlowNode & { vx: number; vy: number };
      const b = link.t as FlowNode & { vx: number; vy: number };
      const dx = (b.x ?? 0) - (a.x ?? 0);
      const dy = (b.y ?? 0) - (a.y ?? 0);
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (d - linkLength(link.t.depth ?? 0)) * 0.035;
      a.vx += (dx / d) * force;
      a.vy += (dy / d) * force;
      b.vx -= (dx / d) * force;
      b.vy -= (dy / d) * force;
    }
    for (const node of nodesWithVelocity) {
      if (node.kind === "root") {
        node.x = cx; node.y = cy; node.vx = 0; node.vy = 0;
        continue;
      }
      node.vx += (cx - (node.x ?? 0)) * 0.0016;
      node.vy += (cy - (node.y ?? 0)) * 0.0016;
      node.vx *= 0.82;
      node.vy *= 0.82;
      node.x = (node.x ?? 0) + node.vx;
      node.y = (node.y ?? 0) + node.vy;
      const r = radius(node) + 4;
      node.x = Math.max(r, Math.min(W - r, node.x));
      node.y = Math.max(r, Math.min(H - r, node.y));
    }
  };
  for (let i = 0; i < 260; i++) step();

  const free = nodes.filter((node) => node.kind !== "root");
  if (free.length) {
    const pad = 46;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    nodes.forEach((node) => {
      const r = radius(node);
      x0 = Math.min(x0, (node.x ?? 0) - r);
      x1 = Math.max(x1, (node.x ?? 0) + r);
      y0 = Math.min(y0, (node.y ?? 0) - r);
      y1 = Math.max(y1, (node.y ?? 0) + r);
    });
    if (x1 - x0 >= 1 && y1 - y0 >= 1) {
      const ky = Math.min((H - pad * 2) / (y1 - y0), 2.6);
      const kx = Math.min((W - pad * 2) / (x1 - x0), ky * 1.85, 3.4);
      const ox = (x0 + x1) / 2;
      const oy = (y0 + y1) / 2;
      nodes.forEach((node) => {
        node.x = cx + ((node.x ?? 0) - ox) * kx;
        node.y = cy + ((node.y ?? 0) - oy) * ky;
      });
    }
  }
  return { nodes, links, maxCalls, radius };
}

function linkPath(link: FlowLink): string {
  const sx = link.s.x ?? 0, sy = link.s.y ?? 0;
  const tx = link.t.x ?? 0, ty = link.t.y ?? 0;
  const mx = (sx + tx) / 2, my = (sy + ty) / 2;
  return `M${sx.toFixed(1)},${sy.toFixed(1)} Q${(mx - (ty - sy) * 0.12).toFixed(1)},${(my + (tx - sx) * 0.12).toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}`;
}

export interface FlowGraphProps {
  /** Rows from the one loaded snapshot; an empty range clears the graph. */
  rows: AnalyticsRow[];
  /** node_sessions from the same snapshot profile. */
  sessions?: Record<string, unknown> | null;
  initialDepth?: FlowDepth;
}

export default function FlowGraph({
  rows,
  sessions = null,
  initialDepth = 3,
}: FlowGraphProps) {
  const [depth, setDepth] = useState<FlowDepth>(initialDepth);
  const [hovered, setHovered] = useState<FlowNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const root = useMemo(() => flowData(rows, depth), [rows, depth]);
  const graph = useMemo(() => layout(root), [root]);
  const fullModels = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      const full = String(row.model ?? "");
      if (full) map.set(short(full), full);
    }
    return map;
  }, [rows]);

  const empty = rows.length === 0;
  const nProviders = root.kids.length;
  const nModels = root.kids.reduce((sum, provider) => sum + provider.kids.length, 0);
  const sub = empty
    ? "no data in this range"
    : `${nProviders} providers · ${nModels} models · ${graph.nodes.length} nodes · ${root.calls.toLocaleString()} calls`;
  const chatList = hovered ? flowChats(hovered, rows, sessions) : [];

  return (
    <section className="card flow-card" aria-label="Provider to model to task">
      <div className="lbl flow-head">
        Provider → model → task
        <span className="muted flow-sub" id="flowsub">{sub}</span>
        <span className="flowctl" id="flowctl">
          <button type="button" data-fd="2" className={depth === 2 ? "on" : ""}
            aria-pressed={depth === 2} onClick={() => { setDepth(2); setHovered(null); }}>
            provider → model
          </button>
          <button type="button" data-fd="3" className={depth === 3 ? "on" : ""}
            aria-pressed={depth === 3} onClick={() => { setDepth(3); setHovered(null); }}>
            + task
          </button>
          <button type="button" aria-label="Zoom out" data-flowzoom="out" title="Zoom out"
            onClick={() => setZoom((value) => value / 1.4)}>&minus;</button>
          <button type="button" aria-label="Zoom in" data-flowzoom="in" title="Zoom in"
            onClick={() => setZoom((value) => value * 1.4)}>+</button>
          <button type="button" aria-label="Reset pan/zoom to fit" data-flowfit
            title="Reset pan/zoom to fit" onClick={() => setZoom(1)}>Fit</button>
        </span>
      </div>
      <div className="flowwrap" id="flowwrap">
        <svg id="flow" viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={empty ? "no data in this range" : `Flow of ${root.calls.toLocaleString()} calls`}>
          <g transform={`translate(${W / 2} ${H / 2}) scale(${zoom}) translate(${-W / 2} ${-H / 2})`}>
            <g className="flow-links">
              {!empty && graph.links.map((link) => (
                <path key={`${link.s.id}-${link.t.id}`} className="lnk" d={linkPath(link)}
                  strokeWidth={Math.max(0.6, Math.sqrt(link.t.calls / graph.maxCalls) * 5).toFixed(2)} />
              ))}
            </g>
            <g className="flow-nodes">
              {!empty && graph.nodes.map((node) => {
                const r = graph.radius(node);
                const modelHint = node.kind === "task"
                  ? fullModels.get(node.parentModel ?? "") ?? ""
                  : fullModels.get(node.name) ?? "";
                const mark = flowNodeMark(node, modelHint);
                const label = node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name;
                return (
                  <g key={node.id} className={`nd ${node.kind}`} data-kind={node.kind}
                    data-id={node.id} role="button" tabIndex={0}
                    aria-label={`${node.name}: ${node.calls.toLocaleString()} calls`}
                    transform={`translate(${(node.x ?? 0).toFixed(1)},${(node.y ?? 0).toFixed(1)})`}
                    onMouseEnter={() => setHovered(node)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(node)}
                    onBlur={() => setHovered(null)}>
                    <circle className="flow-disc" r={r.toFixed(1)} fill={flowColor(node)}
                      fillOpacity={node.kind === "task" ? 0.55 : 0.9}
                      stroke={flowColor(node)} strokeWidth="1.5" />
                    <circle className="hitarea" r={Math.max(r, 12).toFixed(1)} fill="transparent" />
                    {r > 9 || node.kind === "root" ? (
                      <svg className="nd-mark" x={-7} y={-7} width="14" height="14"
                        viewBox="0 0 24 24" aria-hidden="true"><path d={mark} /></svg>
                    ) : null}
                    {node.kind !== "task" || r > 9 ? (
                      <text className="nd-label" y={(r + 10).toFixed(1)}>{label}</text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
        <FlowTip node={hovered} rootCalls={root.calls} color={hovered ? flowColor(hovered) : undefined}
          chats={chatList}
          position={hovered
            ? { left: `${Math.min(80, ((hovered.x ?? 0) / W) * 100 + 1)}%`, top: `${Math.max(0, ((hovered.y ?? 0) / H) * 100 - 2)}%` }
            : undefined} />
      </div>
    </section>
  );
}
