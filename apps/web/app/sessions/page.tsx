"use client";

// T-23 RUN A: Sessions page shell. The matrix and weight control mirror the
// read-only Python Sessions view; the drawer itself is a RUN B stub.
import { useEffect, useState } from "react";

import ProjectMatrix from "@/components/sessions-logs/ProjectMatrix";
import WeightToggle from "@/components/sessions-logs/WeightToggle";
import { readWeight, saveWeight } from "@/lib/sessions-logs/aggregate";
import { weightNote } from "@/lib/sessions-logs/format";
import { loadAnalyticsProfile } from "@/lib/sessions-logs/load";
import type { SessionRow, WeightAxis } from "@/lib/sessions-logs/types";
import "@/styles/sessions-matrix.css";

export default function SessionsPage() {
  const [axis, setAxis] = useState<WeightAxis>("cost");
  const [rows, setRows] = useState<readonly SessionRow[]>([]);

  useEffect(() => {
    setAxis(readWeight());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadAnalyticsProfile(controller.signal)
      .then((loaded) => setRows(loaded.rows))
      .catch(() => setRows([]));
    return () => controller.abort();
  }, []);

  const changeAxis = (next: WeightAxis): void => {
    setAxis(next);
    saveWeight(next);
  };

  return (
    <main className="view sm-view">
      <h1>Sessions</h1>
      <section className="sm-card">
        <div className="sm-title">
          <span>Weight by</span>
          <WeightToggle value={axis} onChange={changeAxis} />
        </div>
        <div id="projweightnote" className="sm-muted sm-note">
          {weightNote(axis)}
        </div>
      </section>
      <section className="sm-card">
        <div className="sm-title">
          <span>
            Project × model
            <span className="sm-muted sm-normal sm-subtitle">
              {" "}
              — cost weighting, sorted by project total
            </span>
          </span>
        </div>
        <ProjectMatrix rows={rows} axis={axis} onOpen={() => {}} />
      </section>
    </main>
  );
}
