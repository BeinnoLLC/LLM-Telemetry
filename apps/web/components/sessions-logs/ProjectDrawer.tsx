"use client";

// T-23 RUN B: project drill-down drawer. Mirrors views.js:1651-1745 and the
// dashboard's #pdrawer markup; the Python drawer remains the DOM/text oracle.
import { useMemo, useRef, type MouseEvent } from "react";
import { buildProjectDetail } from "../../lib/sessions-logs/aggregate";
import { fmtInt, fmtMoney } from "../../lib/sessions-logs/format";
import { providerColorVar, providerPath } from "../../lib/sessions-logs/providers";
import type { DetailBucket, SessionRow } from "../../lib/sessions-logs/types";
import useOverlayFocus from "../../lib/sessions-logs/use-overlay-focus";
import SessionIndexChip from "./SessionIndexChip";

interface ProviderIconProps {
  provider: string;
}

function ProviderIcon({ provider }: ProviderIconProps) {
  return (
    <svg
      className="lvprovlogo"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ color: `var(${providerColorVar(provider)})` }}
    >
      <path d={providerPath(provider)} />
    </svg>
  );
}

interface StatRowProps {
  label: string;
  value: string;
}

function StatRow({ label, value }: StatRowProps) {
  return (
    <div className="pdstat">
      <span className="k">{label}</span>
      <span>{value}</span>
    </div>
  );
}

interface BarRowProps {
  bucket: DetailBucket;
  icon?: string;
}

function BarRow({ bucket, icon }: BarRowProps) {
  return (
    <div className="pdstat">
      <span className="k">
        {icon ? <ProviderIcon provider={icon} /> : null}
        {icon ? " " : ""}
        {bucket.label}
      </span>
      <span>
        {fmtMoney(bucket.cost)} <span className="muted">({bucket.pct}%)</span>
      </span>
    </div>
  );
}

export interface DrawerOpener {
  id: string;
  profile: string;
}

export interface ProjectDrawerProps {
  rows: readonly SessionRow[];
  project: string | null;
  model?: string;
  profile?: string;
  opener?: DrawerOpener;
  onClose: () => void;
  onSession: (sessionId: string, profile: string, title: string) => void;
}

export default function ProjectDrawer({
  rows,
  project,
  model,
  profile,
  opener,
  onClose,
  onSession,
}: ProjectDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const open = project !== null;
  const detail = useMemo(
    () => buildProjectDetail(rows, project ?? ""),
    [rows, project],
  );

  useOverlayFocus({ open, modalRef: drawerRef, scrimRef, bodyRef, onClose });

  /** Read the data attributes at click time so the arrow stays honest even if
   * a harness re-arms the opener; the Python oracle reads them too. */
  const openFromButton = (event: MouseEvent<HTMLButtonElement>): void => {
    const button = event.currentTarget;
    const id = button.dataset.tsession ?? "";
    const targetProfile = button.dataset.tprofile || profile || opener?.profile || "";
    const title = button.textContent?.trim() || id;
    if (id) onSession(id, targetProfile, title);
  };

  return (
    <>
      <div
        id="pdscrim"
        ref={scrimRef}
        className={`scrim pd-scrim${open ? " open" : ""}`}
        aria-hidden={!open}
        onClick={open ? onClose : undefined}
      />
      <aside
        id="pdrawer"
        ref={drawerRef}
        className={`drawer drawer-wide pd-drawer${open ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Project detail"
        aria-hidden={!open}
        data-model={model ?? ""}
      >
        <div className="pdhead">
          <b id="pdtitle">{detail.project}</b>
          <button
            id="pdclose"
            className="chip"
            type="button"
            aria-label="Close details"
            title="Close (Esc)"
            tabIndex={open ? 0 : -1}
            onClick={onClose}
          >
            &times;
          </button>
        </div>
        <div id="pdbody" ref={bodyRef} tabIndex={-1}>
          <div className="pdsection">
            <div className="lbl">Totals</div>
            <StatRow label="Sessions" value={detail.sessions} />
            <StatRow label="Calls" value={fmtInt(detail.calls)} />
            <StatRow
              label="Tokens in / out"
              value={`${fmtInt(detail.inp)} / ${fmtInt(detail.outp)}`}
            />
            <StatRow
              label="Cache read / write"
              value={`${fmtInt(detail.cread)} / ${fmtInt(detail.cwrite)}`}
            />
            <div className="pdstat">
              <span className="k">Cost — actual</span>
              <span className="pdcost-actual">{fmtMoney(detail.act)}</span>
            </div>
            <div className="pdstat">
              <span className="k">Cost — estimated</span>
              <span className="pdcost-est">{fmtMoney(detail.est)} (est.)</span>
            </div>
            <StatRow label="First seen" value={detail.firstSeen} />
            <StatRow label="Last seen" value={detail.lastSeen} />
          </div>
          <div className="pdsection">
            <div className="lbl">Model breakdown</div>
            {detail.models.map((bucket) => (
              <BarRow key={bucket.key} bucket={bucket} icon={bucket.provider} />
            ))}
          </div>
          <div className="pdsection">
            <div className="lbl">Provider breakdown</div>
            {detail.providers.map((bucket) => (
              <BarRow key={bucket.key} bucket={bucket} icon={bucket.key} />
            ))}
          </div>
          <div className="pdsection">
            <div className="lbl">Task / tool mix</div>
            {detail.tasks.map((bucket) => (
              <BarRow key={bucket.key} bucket={bucket} />
            ))}
          </div>
          <div className="pdsection">
            <div className="lbl">Recent sessions</div>
            {detail.hasSessionIds ? (
              detail.recent.map((session) => (
                <SessionIndexChip
                  key={session.id}
                  sessionId={session.id}
                  profile={profile || opener?.profile || ""}
                  onClick={openFromButton}
                >
                  {session.id}
                  {session.date ? (
                    <span className="muted"> · {session.date}</span>
                  ) : null}
                </SessionIndexChip>
              ))
            ) : (
              <SessionIndexChip
                sessionId={opener?.id ?? ""}
                profile={profile || opener?.profile || ""}
                muted
                onClick={openFromButton}
              >
                No individual session ids in this range.
              </SessionIndexChip>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
