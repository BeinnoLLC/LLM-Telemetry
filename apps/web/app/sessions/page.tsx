"use client";

// T-23 RUN B + D: Sessions page shell. RUN A's matrix and weight control stay
// untouched; RUN B wired in the drawer and transcript modal, and RUN D added
// the two presentational project charts, all with the Python dashboard as the
// DOM/text oracle.
import { useEffect, useState } from "react";

import ProjectCharts from "@/components/sessions-logs/ProjectCharts";
import ProjectDrawer, { type DrawerOpener } from "@/components/sessions-logs/ProjectDrawer";
import ProjectMatrix from "@/components/sessions-logs/ProjectMatrix";
import TranscriptModal, {
  type TranscriptSession,
} from "@/components/sessions-logs/TranscriptModal";
import WeightToggle from "@/components/sessions-logs/WeightToggle";
import { readWeight, saveWeight } from "@/lib/sessions-logs/aggregate";
import { weightNote } from "@/lib/sessions-logs/format";
import { loadAnalyticsProfile, sessionOpeners } from "@/lib/sessions-logs/load";
import type { SessionRow, WeightAxis } from "@/lib/sessions-logs/types";
import "@/styles/project-charts.css";
import "@/styles/project-drawer.css";
import "@/styles/sessions-matrix.css";
import "@/styles/transcript-modal.css";

interface DrawerState {
  project: string;
  model?: string;
}

export default function SessionsPage() {
  const [axis, setAxis] = useState<WeightAxis>("cost");
  const [rows, setRows] = useState<readonly SessionRow[]>([]);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSession | null>(null);
  const [profile, setProfile] = useState("");
  const [opener, setOpener] = useState<DrawerOpener | undefined>(undefined);
  const [sessionProfiles, setSessionProfiles] = useState<Record<string, string>>({});

  useEffect(() => {
    setAxis(readWeight());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadAnalyticsProfile(controller.signal)
      .then((loaded) => {
        const openers = sessionOpeners(loaded.payload, loaded.profileName);
        setRows(loaded.rows);
        // main.js:86 keeps the owning profile on every merged recent session.
        // The drawer must use it instead of the synthetic "All" name, or the
        // transcript lookup resolves to zero messages.
        setProfile(openers.opener?.profile ?? loaded.profileName);
        setOpener(openers.opener);
        setSessionProfiles(openers.profiles);
      })
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
        <ProjectMatrix
          rows={rows}
          axis={axis}
          onOpen={(project, model) => setDrawer({ project, model })}
        />
        <ProjectCharts rows={rows} axis={axis} />
      </section>
      <ProjectDrawer
        rows={rows}
        project={drawer?.project ?? null}
        model={drawer?.model}
        profile={profile}
        opener={opener}
        sessionProfiles={sessionProfiles}
        onClose={() => setDrawer(null)}
        onSession={(id, targetProfile, title) =>
          setTranscript({ id, profile: targetProfile, title })
        }
      />
      <TranscriptModal session={transcript} onClose={() => setTranscript(null)} />
    </main>
  );
}
