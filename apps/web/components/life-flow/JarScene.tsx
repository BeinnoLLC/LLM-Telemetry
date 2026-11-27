"use client";

// LLMTELEMET-292 (T-21 RUN B): the jar scene shared by Life and Flow.
// The T-20 TaskQueue is the composition of T-20 Jar, QueueBall,
// buildTaskQueue and providerIcon; it is reused here, never copied or
// modified. This wrapper owns only the shared page frame, so both pages
// keep the same three jars, counts, legend and SVG-only provider marks.
import type { HomeSnapshot } from "../../lib/home-board/types";
import "../../styles/life-flow-jars.css";
import TaskQueue from "../home-board/TaskQueue";

export interface JarSceneProps {
  initial: HomeSnapshot;
  name: string;
  /** Fixed packing box; jsdom has no ResizeObserver. */
  boxWidth?: number;
  boxHeight?: number;
}

export default function JarScene({
  initial,
  name,
  boxWidth = 240,
  boxHeight = 220,
}: JarSceneProps) {
  return (
    <div className="lf-jar-scene" data-scene="life-flow-queue">
      <TaskQueue
        initial={initial}
        name={name}
        boxWidth={boxWidth}
        boxHeight={boxHeight}
      />
    </div>
  );
}
