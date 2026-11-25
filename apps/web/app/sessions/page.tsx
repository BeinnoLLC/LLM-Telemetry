"use client";

// T-23 RUN B: Sessions page shell. RUN A's matrix and weight control stay
// untouched; the drawer and transcript modal are now wired in, with the Python
// dashboard as the DOM/text oracle.
import { useEffect, useState } from "react";

import ProjectDrawer, { type DrawerOpener } from "@/components/sessions-logs/ProjectDrawer";
import ProjectMatrix from "@/components/sessions-logs/ProjectMatrix";
import TranscriptModal, {
  type TranscriptSession,
} from "@/components/sessions-logs/TranscriptModal";
import WeightToggle from "@/components/sessions-logs/WeightToggle";
import { readWeight, saveWeight } from "@/lib/sessions-logs/aggregate";
import { weightNote } from "@/lib/sessions-logs/format";
import { loadAnalyticsProfile } from "@/lib/sessions-logs/load";
import type { SessionRow, WeightAxis } from "@/lib/sessions-logs/types";
import "@/styles/project-drawer.css";
import "@/styles/sessions-matrix.css";
import "@/styles/transcript-modal.css";

interface DrawerState {
  project: string;
  model?: string;
}

interface RecentSession {
  id?: unknown;
}

interface PayloadWithSessions {
  profiles?: Record<string, { recent_sessions?: RecentSession[] }>;
}

/** Real session id from the loaded artifact; never a synthesised placeholder.
 * The note row in the drawer carries it as its transcript opener. */
function firstSessionOpener(
  payload: object,
  profileName: string,
): DrawerOpener | undefined {
  const source = payload as PayloadWithSessions;
  const profile =
    source.profiles?.[profileName] ?? Object.values(source.profiles ?? {})[0];
  const recent = Array.isArray(profile?.recent_sessions) ? profile.recent_sessions : [];
  for (const item of recent) {
    if (item && item.id !== null && item.id !== undefined && item.id !== "") {
      return { id: String(item.id), profile: profileName };
    }
  }
  return undefined;
}

export default function SessionsPage() {
  const [axis, setAxis] = useState<WeightAxis>("cost");
  const [rows, setRows] = useState<readonly SessionRow[]>([]);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSession | null>(null);
  const [profile, setProfile] = useState("");
  const [opener, setOpener] = useState<DrawerOpener | undefined>(undefined);

  useEffect(() => {
    setAxis(readWeight());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadAnalyticsProfile(controller.signal)
      .then((loaded) => {
        setRows(loaded.rows);
        setProfile(loaded.profileName);
        setOpener(firstSessionOpener(loaded.payload, loaded.profileName));
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
      </section>
      <ProjectDrawer
        rows={rows}
        project={drawer?.project ?? null}
        model={drawer?.model}
        profile={profile}
        opener={opener}
        onClose={() => setDrawer(null)}
        onSession={(id, targetProfile, title) =>
          setTranscript({ id, profile: targetProfile, title })
        }
      />
      <TranscriptModal session={transcript} onClose={() => setTranscript(null)} />
    </main>
  );
}
