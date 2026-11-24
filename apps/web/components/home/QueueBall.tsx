"use client";

// LLMTELEMET-291 (T-20 RUN E2): one task = one bead. The mark is always an
// inline SVG path from providerIcon; a ball never carries a letter glyph.
// QT_MIN (18px) is the floor enforced in queue.ts; the CSS disc behind the
// mark keeps it legible at that size.
import type { CSSProperties } from "react";

import { providerIcon } from "../../lib/home/provider-icons";
import { QT_MIN, type QueueBall as QueueBallData } from "../../lib/home/queue";

export interface QueueBallProps {
  ball: QueueBallData;
  x: number;
  y: number;
  rz?: number;
  size?: number;
}

export default function QueueBall({
  ball,
  x,
  y,
  rz = 0,
  size = QT_MIN + 8,
}: QueueBallProps) {
  const path = providerIcon(ball.model, ball.kind);
  const style = {
    "--sz": `${Math.max(QT_MIN, size)}px`,
    "--rz": `${rz}deg`,
    left: `${x}px`,
    top: `${y}px`,
  } as CSSProperties;

  return (
    <button
      type="button"
      className={`qt-ball${ball.kind === "r" ? " qt-run" : ""}`}
      data-key={ball.key}
      data-kind={ball.kind}
      data-model={ball.model ?? ""}
      style={style}
      title={ball.label}
      aria-label={ball.label}
    >
      <span className="qt-gl" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d={path} />
        </svg>
      </span>
    </button>
  );
}
