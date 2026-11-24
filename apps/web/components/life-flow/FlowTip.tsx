"use client";

// LLMTELEMET-292 (T-21 RUN C2): the Flow tooltip, matching flow.js:950-973.
// Rows come from the aggregated snapshot; there is no synthetic chat or cost.
import type { CSSProperties } from "react";

import {
  flowTipRows,
  type FlowChat,
  type FlowNode,
} from "../../lib/life-flow/flow";
import "../../styles/life-flow-graph.css";

export interface FlowTipProps {
  node: FlowNode | null;
  rootCalls: number;
  color?: string;
  chats?: FlowChat[];
  position?: CSSProperties;
}

export default function FlowTip({
  node,
  rootCalls,
  color = "var(--accent)",
  chats = [],
  position,
}: FlowTipProps) {
  const rows = node ? flowTipRows(node, rootCalls) : [];
  return (
    <div
      id="flowtip"
      className={node ? "flowtip on" : "flowtip"}
      role="tooltip"
      style={position}
    >
      {node && (
        <>
          <div className="ft-h" style={{ color }}>{node.name}</div>
          {rows.map(([label, value]) => (
            <div className="ft-r" key={label}>
              <span>{label}</span><b>{value}</b>
            </div>
          ))}
          {chats.length > 0 && (
            <>
              <div className="ft-s">chats</div>
              {chats.map((chat) => (
                <div className="ft-c" key={chat.id}>
                  <span>{chat.title}</span><b>{chat.calls.toLocaleString()}</b>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
