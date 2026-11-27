// LLMTELEMET-292 (T-21 RUN A2): the Life view's quota card, mirroring
// dashboard.html:183-187 and quotaview.js:529-558. Styling uses tokens only;
// every count and meter comes from the loaded artifact.
import type { CSSProperties } from "react";

import type { QuotaData } from "../../lib/home-board/types";
import {
  lifeRows,
  qvAttention,
  qvKpis,
  type QuotaProfile,
} from "../../lib/life-flow/quota";

const CARD: CSSProperties = {
  padding: "1rem",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-ctl)",
  background: "var(--card)",
};
const LABEL: CSSProperties = { marginBottom: "0.625rem", fontWeight: 600 };
const SUB: CSSProperties = { color: "var(--muted)", fontSize: "var(--fs-xs)" };
const MUTED: CSSProperties = { color: "var(--muted)" };
const KPI_STRIP: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  gap: "0.6rem",
  margin: "0.2rem 0 0.8rem",
};
const KPI_TILE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.15rem",
  minWidth: 0,
  padding: "0.6rem 0.8rem",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-ctl)",
};
const KPI_VALUE: CSSProperties = {
  fontSize: "var(--fs-lg)",
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.1,
};
const KPI_LABEL: CSSProperties = {
  color: "var(--muted)",
  fontSize: "var(--fs-xs)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};
const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  flexWrap: "wrap",
  padding: "0.3rem 0",
};
const NAME: CSSProperties = {
  flex: "0 0 auto",
  minWidth: "60px",
  fontWeight: 600,
  fontSize: "var(--fs-xs)",
};
const BADGE: CSSProperties = {
  display: "inline-block",
  padding: "0.05rem 0.45rem",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-pill)",
  fontSize: "var(--fs-xs)",
  whiteSpace: "nowrap",
};
const BAR_WRAP: CSSProperties = { flex: "1 1 80px", minWidth: "60px" };
const TRACK: CSSProperties = {
  display: "block",
  width: "100%",
  height: "8px",
  borderRadius: "var(--r-pill)",
  background: "var(--border)",
  overflow: "hidden",
};
const FILL: CSSProperties = {
  display: "block",
  height: "100%",
  borderRadius: "var(--r-pill)",
};

const LEVEL_FG: Record<string, string> = {
  ok: "var(--z-ok-fg)",
  warn: "var(--z-warn-fg)",
  bad: "var(--z-bad-fg)",
  mute: "var(--muted)",
};
const LEVEL_BG: Record<string, string> = {
  ok: "var(--z-ok)",
  warn: "var(--z-warn)",
  bad: "var(--z-bad)",
  mute: "var(--muted)",
};

export interface LifeQuotaProps {
  name: string;
  profile: QuotaProfile | null;
  quota: QuotaData | null;
}

export default function LifeQuota({ name, profile, quota }: LifeQuotaProps) {
  const rows = lifeRows(profile, qvAttention(quota));
  const kpis = qvKpis(profile);
  const sub = name
    ? `${name} · ${rows.length} provider${rows.length === 1 ? "" : "s"}`
    : "";

  return (
    <section className="card" id="lifequota" style={CARD}>
      <div className="lbl" style={LABEL}>
        Quota
        <span id="lifequotasub" style={SUB}>{sub}</span>
      </div>
      <div id="lifequotabody">
        {rows.length === 0 ? (
          <div className="muted" style={MUTED}>
            No quota data cached for this profile.
          </div>
        ) : (
          <>
            {kpis.length > 0 && (
              <div className="qv-kpis" style={KPI_STRIP}>
                {kpis.map((kpi, index) => (
                  <div
                    className={kpi.cls ? `qv-kpi ${kpi.cls}` : "qv-kpi"}
                    key={`${kpi.label}-${index}`}
                    style={KPI_TILE}
                  >
                    <b
                      className="qv-kv"
                      style={{ ...KPI_VALUE, color: LEVEL_FG[kpi.cls.replace("qv-kpi-", "")] ?? "var(--fg)" }}
                    >
                      {kpi.value}
                    </b>
                    <span style={KPI_LABEL}>{kpi.label}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="qv-provs">
              {rows.map((row) => (
                <div
                  className="qv-liferow"
                  data-level={row.level}
                  key={row.key}
                  style={ROW}
                >
                  <span className="qv-wname" style={{ ...NAME, color: row.color }}>
                    {row.label}
                  </span>
                  <span
                    className={`rt-auth rt-${row.statusClass}`}
                    style={{ ...BADGE, color: LEVEL_FG[row.statusClass.replace("rt-", "")] ?? "var(--muted)" }}
                  >
                    {row.status}
                  </span>
                  <span className="qv-lifebar" style={BAR_WRAP}>
                    <span
                      className="qv-track"
                      role="img"
                      aria-label={row.bar.label}
                      style={TRACK}
                    >
                      <i
                        className={`qv-fill qv-${row.bar.level}`}
                        style={{ ...FILL, width: `${row.bar.width}%`, background: LEVEL_BG[row.bar.level] }}
                      />
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
