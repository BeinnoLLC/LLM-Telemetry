"use client";

// LLMTELEMET-291 (T-20 RUN E2): the Home task queue — Depot, On the line,
// Yard — fed by the RUN B live snapshot and shaped by the RUN E1 queue
// functions. No value is re-derived here; the legend and every ball use the
// same SVG-only providerIcon source.
import { buildTaskQueue } from "../../lib/home-board/queue";
import { providerIcon } from "../../lib/home-board/provider-icons";
import type { HomeSnapshot } from "../../lib/home-board/types";
import "../../styles/home-jars.css";
import Jar from "./Jar";
import { useLiveHome } from "./useLiveHome";

export interface TaskQueueProps {
  initial: HomeSnapshot;
  name: string;
  /** Fixed packing box; jsdom has no ResizeObserver. */
  boxWidth?: number;
  boxHeight?: number;
}

export default function TaskQueue({
  initial,
  name,
  boxWidth = 240,
  boxHeight = 220,
}: TaskQueueProps) {
  const live = useLiveHome(initial);
  const queue = buildTaskQueue(live, name);
  const legendPath = providerIcon(null, "legend");

  return (
    <section id="qcard" className="home-section card p-4" aria-label="Task queue">
      <div className="lbl mb-2.5">
        Task queue
        <span className="qsub muted" id="qsub">{queue.qsub}</span>
      </div>
      <div className="qtrain" id="qtrain">
        <Jar
          id="queued"
          kind="q"
          label="Depot"
          ariaLabel="Depot: waiting"
          carsAriaLabel="Waiting tasks"
          empty="Nothing queued"
          balls={queue.queued}
          width={boxWidth}
          height={boxHeight}
        />
        <Jar
          id="running"
          kind="r"
          label="On the line"
          ariaLabel="On the line: running"
          carsAriaLabel="Running tasks"
          empty="No live sessions"
          balls={queue.running}
          width={boxWidth}
          height={boxHeight}
        />
        <Jar
          id="done"
          kind="d"
          label="Yard"
          ariaLabel="Yard: done"
          carsAriaLabel="Finished tasks"
          empty="No finished sessions"
          balls={queue.done}
          width={boxWidth}
          height={boxHeight}
        />
      </div>
      <div className="qt-legend" aria-hidden="true">
        <span>
          <i className="qt-sw qt-sw-wait">
            <b className="qt-gl" id="qt-leg-ico" data-kind="legend">
              <svg viewBox="0 0 24 24" focusable="false"><path d={legendPath} /></svg>
            </b>
          </i>
          Ollama request
        </span>
        <span><i className="qt-sw qt-sw-glow" />Glow = live now</span>
        <span><i className="qt-sw qt-sw-ring" />Ring = waiting on approval</span>
        <span>Ball icon = LLM provider</span>
      </div>
    </section>
  );
}
