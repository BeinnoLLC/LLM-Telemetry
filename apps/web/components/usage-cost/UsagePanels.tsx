// LLMTELEMET-293 (T-22 RUN B): the remaining Usage panels. Client-side state
// is limited to the two behaviours the Python view keeps in memory between
// renders: XF_SEEN (a byte-less refresh must not blank the transfer card) and
// the expanded repo keys. Every number is already derived in panels.ts from
// the loaded artifacts; this component only draws it.
"use client";

import { useEffect, useState } from "react";
import { HEXAGON_PATH } from "../../lib/home-board/provider-icons";
import {
  refreshTransfer,
  repoRowId,
  UNATTR_LABEL,
  type BandwidthPanel,
  type ConcurrencyPanel,
  type LatencyPanel,
  type PanelsModel,
  type RepoBranchPanel,
  type UnattributedPanel,
} from "../../lib/usage-cost/panels";

const MARK_VIEW = "0 0 24 24";

function ProviderMark({
  path,
  color,
}: {
  path?: string;
  color: string;
}) {
  return (
    <svg
      className="up-mark"
      viewBox={MARK_VIEW}
      aria-hidden="true"
      style={{ color }}
    >
      <path d={path ?? HEXAGON_PATH} fill="currentColor" />
    </svg>
  );
}

function TransferCard({ initial }: { initial: PanelsModel["transfer"] }) {
  const [transfer, setTransfer] = useState(initial);
  useEffect(() => {
    setTransfer((previous) => refreshTransfer(previous, initial));
  }, [initial]);
  if (transfer.hidden) return null;
  return (
    <section
      className="uc-card up-card"
      data-panel="transfer"
      data-xfer-seen={String(transfer.seen)}
      data-xfer-sticky={String(transfer.sticky)}
    >
      <h2>Transfers</h2>
      <div className="up-totals" data-testid="xfertot">
        <span className="up-leg">
          <span className="up-arrow up-up" aria-hidden="true">↑</span>
          <span className="up-big">{transfer.upText}</span>
          <span className="up-caption">up</span>
        </span>
        <span className="up-leg">
          <span className="up-arrow up-down" aria-hidden="true">↓</span>
          <span className="up-big">{transfer.downText}</span>
          <span className="up-caption">down</span>
        </span>
        {transfer.ratioText && <span className="up-ratio">{transfer.ratioText}</span>}
      </div>
      <p className="up-note" data-testid="xfernote">{transfer.note}</p>
    </section>
  );
}

function BandwidthTrend({ panel }: { panel: BandwidthPanel }) {
  const W = 640;
  const H = 220;
  const LEFT = 36;
  const RIGHT = W - 44;
  const TOP = 18;
  const BOTTOM = H - 30;
  const leftPeak = Math.max(
    1,
    ...panel.trend.filter((s) => s.axis === "left").flatMap((s) => s.values),
  );
  const rightPeak = Math.max(
    1,
    ...panel.trend.filter((s) => s.axis === "right").flatMap((s) => s.values),
  );
  const count = Math.max(1, panel.days.length);
  const slot = (RIGHT - LEFT) / count;
  const xAt = (i: number) => LEFT + slot * (i + 0.5);
  const yAt = (value: number, axis: "left" | "right") =>
    BOTTOM - (Math.max(0, value) / (axis === "left" ? leftPeak : rightPeak)) * (BOTTOM - TOP);
  return (
    <div className="uc-plot up-plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bandwidth trend by day">
        <line className="uc-axis-line" x1={LEFT} y1={BOTTOM} x2={RIGHT} y2={BOTTOM} />
        <text className="uc-axis" x={LEFT} y={TOP - 6} data-axis-label="left">
          {panel.axes.left}
        </text>
        <text className="uc-axis" x={RIGHT} y={TOP - 6} textAnchor="end" data-axis-label="right">
          {panel.axes.right}
        </text>
        {panel.trend.map((series) => {
          const barW = Math.min(20, slot * 0.5);
          return (
            <g
              key={series.key}
              className="up-band-series"
              data-series={series.key}
              data-axis={series.axis}
              data-kind={series.kind}
              data-dashed={String(series.dashed)}
            >
              {series.kind === "bar"
                ? series.values.map((value, i) => (
                    <rect
                      key={i}
                      className="uc-bar"
                      x={xAt(i) - barW / 2}
                      y={yAt(value, series.axis)}
                      width={barW}
                      height={BOTTOM - yAt(value, series.axis)}
                      rx={2}
                      style={{ fill: series.color }}
                    />
                  ))
                : (
                    <polyline
                      fill="none"
                      strokeWidth={2}
                      strokeDasharray={series.dashed ? "4 3" : undefined}
                      points={series.values.map((value, i) =>
                        `${xAt(i)},${yAt(value, series.axis)}`,
                      ).join(" ")}
                      style={{ stroke: series.color }}
                    />
                  )}
            </g>
          );
        })}
        {panel.days.map((day, i) => (
          <text
            className="uc-axis"
            key={day.date}
            x={xAt(i)}
            y={H - 8}
            textAnchor="middle"
          >
            {day.label}
          </text>
        ))}
      </svg>
      <table className="uc-legend" data-chart-legend="cBwTrend">
        <tbody>
          {panel.trend.map((series) => (
            <tr key={series.key} data-series={series.key} data-axis={series.axis}>
              <td>
                <i style={{ backgroundColor: series.color }} />
              </td>
              <td>{series.label}</td>
              <td>{series.axis}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BandwidthCard({ panel }: { panel: BandwidthPanel }) {
  if (panel.hidden) return null;
  return (
    <section className="uc-card up-card up-wide" data-panel="bandwidth">
      <h2>Bandwidth</h2>
      {panel.empty ? (
        <p className="up-empty" data-bandwidth-empty="true">
          No bandwidth recorded in this range.
        </p>
      ) : (
        <>
          <p className="uc-meta">{panel.subtitle}</p>
          <div className="up-kpis">
            {panel.kpis.map((kpi) => (
              <div className="up-kpi" key={kpi.key} data-kpi={kpi.key}>
                <div className="up-kpi-value">{kpi.value}</div>
                <div className="up-kpi-label">{kpi.label}</div>
                <div className="up-kpi-sub">{kpi.sub}</div>
              </div>
            ))}
          </div>
          <BandwidthTrend panel={panel} />
          <h3>Context re-send by model</h3>
          <div className="up-resend" data-testid="bwresend">
            {panel.resend.length === 0 ? (
              <p className="up-empty">No prompt tokens in range.</p>
            ) : (
              <>
                {panel.resend.map((row) => (
                  <div
                    className={`up-resend-row${row.hot ? " hot" : ""}`}
                    key={row.model}
                    data-model={row.label}
                    data-x={row.x.toFixed(2)}
                    title={`${row.sent.toLocaleString("en-US")} prompt tokens sent · ${row.fresh.toLocaleString("en-US")} fresh · ${row.calls.toLocaleString("en-US")} calls`}
                  >
                    <span className="up-resend-name" style={{ color: row.color }}>
                      <ProviderMark path={row.icon} color={row.color} />
                      {row.label}
                    </span>
                    <span className="up-resend-track">
                      <i style={{ width: `${row.widthPct.toFixed(1)}%` }} />
                    </span>
                    <span className="up-resend-x">{row.x.toFixed(1)}×</span>
                    <span className="up-resend-flag">
                      {row.hot && <span title="At least 2x the fleet median">▲ high</span>}
                    </span>
                  </div>
                ))}
                <p className="up-note">
                  fleet median {panel.median.toFixed(1)}×
                  {panel.totalModels > panel.shown
                    ? ` · top ${panel.shown} of ${panel.totalModels} models`
                    : ""}
                </p>
              </>
            )}
          </div>
          <p className="up-note" data-testid="bwpnote">{panel.note}</p>
        </>
      )}
    </section>
  );
}

function ConcurrencyChart({ panel }: { panel: ConcurrencyPanel }) {
  const W = 640;
  const H = 220;
  const LEFT = 36;
  const RIGHT = W - 20;
  const TOP = 18;
  const BOTTOM = H - 30;
  const peak = Math.max(1, ...panel.rows.flatMap((row) => [row.top, row.sub, panel.queueNow]));
  const slot = (RIGHT - LEFT) / Math.max(1, panel.rows.length);
  const barW = Math.min(28, slot * 0.6);
  const xAt = (i: number) => LEFT + slot * (i + 0.5);
  const yAt = (value: number) => BOTTOM - (value / peak) * (BOTTOM - TOP);
  return (
    <div className="uc-plot up-plot">
      <svg id="cConcurrency" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Concurrent sessions by hour">
        <line className="uc-axis-line" x1={LEFT} y1={BOTTOM} x2={RIGHT} y2={BOTTOM} />
        {panel.series.map((series) => (
          <g key={series.key} className="up-conc-series" data-series={series.key} data-dashed={String(series.dashed)}>
            {series.kind === "bar"
              ? series.values.map((value, i) => {
                  // Stack subagent ON TOP of the top-level bar: both start at
                  // the same x, so they must not overlap on the same axis.
                  const base = series.key === "subagent" ? (panel.rows[i]?.top ?? 0) : 0;
                  const yBase = yAt(base);
                  const top = yAt(base + value);
                  return (
                    <rect
                      key={i}
                      className="uc-bar"
                      x={xAt(i) - barW / 2}
                      y={top}
                      width={barW}
                      height={yBase - top}
                      rx={2}
                      style={{ fill: series.color }}
                    />
                  );
                })
              : (
                  <line
                    x1={LEFT}
                    y1={yAt(series.values[0] ?? 0)}
                    x2={RIGHT}
                    y2={yAt(series.values[0] ?? 0)}
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    style={{ stroke: series.color }}
                  />
                )}
          </g>
        ))}
        {panel.rows.map((row, i) => (
          <text className="uc-axis" key={row.hour} x={xAt(i)} y={H - 8} textAnchor="middle">
            {row.label}
          </text>
        ))}
      </svg>
      <table className="uc-legend" data-chart-legend="cConcurrency">
        <tbody>
          {panel.series.map((series) => (
            <tr key={series.key} data-series={series.key}>
              <td><i style={{ backgroundColor: series.color }} /></td>
              <td>{series.label}</td>
              <td>{series.key === "queue-now" ? "now" : "stacked"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConcurrencyCard({ panel }: { panel: ConcurrencyPanel }) {
  return (
    <section className="uc-card up-card" data-panel="concurrency" data-empty={String(panel.empty)}>
      <h2>Concurrency</h2>
      <p className="up-peak" data-testid="concpeak">{panel.peakText}</p>
      {panel.empty ? (
        <p className="up-empty" data-conc-empty="true" data-stale-cleared="true">
          No concurrency in this range.
        </p>
      ) : (
        <ConcurrencyChart panel={panel} />
      )}
    </section>
  );
}

function LatencyRows({
  rows,
  isModel,
}: {
  rows: LatencyPanel["byModel"];
  isModel: boolean;
}) {
  return (
    <>
      {rows.map((row) => (
        <div className="up-lat-row" key={row.name} data-name={row.name} data-n={row.n}>
          <span className="up-lat-name" title={row.name} style={{ color: row.color }}>
            {isModel && <ProviderMark path={row.icon} color={row.color} />}
            {row.name}
          </span>
          <span className="up-muted" title="sample size">n={row.n}</span>
          <span title="p50 / p90 / p99 seconds">
            {row.p50} / {row.p90} / {row.p99}
          </span>
          <span className="up-muted up-lat-rate">{row.tokS}</span>
        </div>
      ))}
    </>
  );
}

function LatencyCard({ panel }: { panel: LatencyPanel }) {
  if (panel.hidden) return null;
  return (
    <section className="uc-card up-card" data-panel="latency">
      <h2>Latency</h2>
      <h3>By model</h3>
      <div data-testid="latbymodel"><LatencyRows rows={panel.byModel} isModel /></div>
      <h3>By endpoint</h3>
      <div data-testid="latbyendpoint"><LatencyRows rows={panel.byEndpoint} isModel={false} /></div>
      {panel.slowest.length > 0 && (
        <div data-testid="latslowest">
          <p className="up-muted">Slowest turns</p>
          {panel.slowest.map((row) => (
            <div className="up-lat-row" key={row.session} data-session={row.session}>
              <span className="up-lat-name">
                <ProviderMark path={row.icon} color="var(--muted)" />
                {row.model}
              </span>
              <span className="up-muted">{row.secondsText}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function UnattributedCard({ panel }: { panel: UnattributedPanel }) {
  if (panel.empty) return null;
  const W = 640;
  const H = 180;
  const PAD = 36;
  const peak = Math.max(1, ...panel.buckets.map((bucket) => bucket.cost));
  const slot = (W - PAD * 2) / Math.max(1, panel.buckets.length);
  const barW = Math.min(48, slot * 0.6);
  return (
    <section className="uc-card up-card up-wide" data-panel="unattributed">
      <h2>Unattributed cost</h2>
      <p className="uc-meta" data-testid="projhdr">{panel.header}</p>
      <div className="uc-plot up-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cost by project">
          <defs>
            <pattern id="uc-unattr-hatch" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6" stroke="var(--muted)" strokeWidth="1" />
            </pattern>
          </defs>
          <line className="uc-axis-line" x1={PAD} y1={H - 28} x2={W - PAD} y2={H - 28} />
          {panel.buckets.map((bucket, i) => {
            const height = (bucket.cost / peak) * (H - 52);
            const x = PAD + i * slot + (slot - barW) / 2;
            return (
              <g
                className="uc-point"
                key={bucket.name}
                data-label={bucket.name}
                data-value={String(bucket.cost)}
                data-unattributed={String(bucket.unattributed)}
              >
                <rect
                  className="uc-bar"
                  x={x}
                  y={H - 28 - height}
                  width={barW}
                  height={height}
                  rx={2}
                  style={{ fill: bucket.hatch ? "url(#uc-unattr-hatch)" : bucket.color }}
                />
                <text className="uc-axis" x={x + barW / 2} y={H - 8} textAnchor="middle">
                  {bucket.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="up-note" title={panel.tooltip}>
        {UNATTR_LABEL} — {panel.tooltip}
      </p>
    </section>
  );
}

function RepoBranchCard({ panel }: { panel: RepoBranchPanel }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  if (panel.hidden) {
    return (
      <section className="uc-card up-card up-wide" data-panel="repo-branch">
        <h2>Repo &amp; branch cost</h2>
        <p className="up-empty" data-repo-empty="true">No repo cost in this snapshot.</p>
      </section>
    );
  }
  const toggle = (repo: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });
  };
  return (
    <section className="uc-card up-card up-wide" data-panel="repo-branch">
      <h2>Repo &amp; branch cost</h2>
      <p className="uc-meta" data-unattr-cost={panel.unattrCost}>{panel.unattrText}</p>
      <div className="up-repo-list" data-testid="repolist">
        {panel.repos.map((repo) => {
          const id = repoRowId(repo.repo);
          const isOpen = expanded.has(repo.repo);
          return (
            <div key={repo.repo}>
              <div
                className="up-repo-row"
                data-repokey={repo.repo}
                data-unattributed={String(repo.unattributed)}
              >
                <button
                  type="button"
                  className="up-repo-toggle"
                  aria-expanded={isOpen}
                  aria-controls={id}
                  onClick={() => toggle(repo.repo)}
                >
                  <span className="up-chevron" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                  <span className="up-name">{repo.repo}</span>
                </button>
                <span className="up-num">{repo.sessions.toLocaleString("en-US")} sess</span>
                <span className="up-num">{repo.calls.toLocaleString("en-US")} calls</span>
                <span className="up-num">{repo.tokensText}</span>
                <span className="up-cost">{repo.costText}</span>
              </div>
              <div id={id} className="up-branch-list" hidden={!isOpen} data-branch-of={repo.repo}>
                {repo.branches.map((branch) => (
                  <div
                    className="up-repo-row up-branch-row"
                    key={`${repo.repo}-${branch.branch}`}
                    data-branch={branch.branch}
                    data-unattributed={String(branch.unattributed)}
                  >
                    <span className="up-name">{branch.branch}</span>
                    <span className="up-num">{branch.sessions.toLocaleString("en-US")} sess</span>
                    <span className="up-num">{branch.calls.toLocaleString("en-US")} calls</span>
                    <span className="up-num">{branch.tokensText}</span>
                    <span className="up-cost">{branch.costText}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Usage panels below the five RUN A charts. Pure data in, no fetching here. */
export default function UsagePanels({ model }: { model: PanelsModel }) {
  return (
    <div className="usage-panels" data-panels-source={model.profile ?? "n/a"}>
      <TransferCard initial={model.transfer} />
      <BandwidthCard panel={model.bandwidth} />
      <ConcurrencyCard panel={model.concurrency} />
      <LatencyCard panel={model.latency} />
      <UnattributedCard panel={model.unattributed} />
      <RepoBranchCard panel={model.repos} />
    </div>
  );
}
