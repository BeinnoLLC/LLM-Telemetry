"use client";

// LLMTELEMET-291 (T-20 RUN E2): the three glass jars ported from
// src/llm_telemetry/web/dashboard.html:161-172. qtFit does the deterministic
// packing and the +N rollup; this component only paints the result. A fixed
// box is passed in (jsdom has no ResizeObserver), so packing is testable.
import { qtFit, type QueueBall as QueueBallData, type QueueKind } from "../../lib/home-board/queue";
import QueueBall from "./QueueBall";

export interface JarProps {
  id: "queued" | "running" | "done";
  kind: QueueKind;
  label: string;
  ariaLabel: string;
  carsAriaLabel: string;
  empty: string;
  balls: QueueBallData[];
  width: number;
  height: number;
}

const JAR_CLASS: Record<QueueKind, string> = {
  q: "qt-depot",
  r: "qt-line",
  d: "qt-yard",
};

export default function Jar({
  id,
  kind,
  label,
  ariaLabel,
  carsAriaLabel,
  empty,
  balls,
  width,
  height,
}: JarProps) {
  const fit = qtFit(balls.map((ball) => ball.key), width, height);
  const byKey = new Map(balls.map((ball) => [ball.key, ball]));

  return (
    <section className={`qt-sec ${JAR_CLASS[kind]}`} aria-label={ariaLabel}>
      <div className="qt-jar">
        <div className="qt-lid">
          <b className={`qt-n qt-n-${id}`} id={`qt-n-${id}`}>{balls.length}</b>
        </div>
        <div className="qt-body">
          <div
            className="qt-cars"
            id={`qt-${id}`}
            role="group"
            aria-label={carsAriaLabel}
            data-empty={empty}
          >
            {fit.keys.map((key, index) => {
              const ball = byKey.get(key);
              const packed = fit.balls[index];
              if (!ball || !packed) return null;
              return (
                <QueueBall
                  key={key}
                  ball={ball}
                  x={packed.x}
                  y={packed.y}
                  rz={packed.rz}
                />
              );
            })}
            {fit.overflow > 0 ? (
              <span className="qt-overflow" aria-label={`${fit.overflow} more tasks`}>
                {fit.more}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="qt-name">{label}</div>
    </section>
  );
}
