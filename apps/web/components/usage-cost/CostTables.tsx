// LLMTELEMET-293 (T-22 RUN C): Cost tab tables and its two hand-drawn charts.
// All numbers arrive from lib/usage-cost/cost.ts; every colour is a token and
// every provider mark is the brand SVG path, never a letter or monogram.
import { compact, fmtB } from "../../lib/home-board/format";
import { HEXAGON_PATH } from "../../lib/home-board/provider-icons";
import {
  RESEND_MIN,
  type AttributionModel,
  type CostModel,
  type CostTaskPoint,
  type ProviderCostRow,
} from "../../lib/usage-cost/cost";

const VIEW_BOX = "0 0 640 220";

function Mark({ path, color }: { path?: string; color: string }) {
  return (
    <svg className="uc-prov-mark" viewBox="0 0 24 24" aria-hidden="true" style={{ color }}>
      <path d={path ?? HEXAGON_PATH} fill="currentColor" />
    </svg>
  );
}

/** views.js:807-816: translucent cost bars on a log axis BEHIND the linear
 * calls line. SVG paints in document order, so bars come first. */
export function TaskCostChart({ points, empty }: { points: readonly CostTaskPoint[]; empty: boolean }) {
  const left = 48;
  const right = 592;
  const top = 18;
  const bottom = 186;
  const peakCalls = Math.max(1, ...points.map((point) => point.calls));
  const slot = points.length ? (right - left) / points.length : 0;
  const costColor = "var(--chart-1)";
  const callColor = "var(--chart-4)";
  return (
    <section className="uc-card" data-chart-id="cTaskCost" data-empty={empty ? "true" : "false"}>
      <h2>Cost by task</h2>
      <div className="uc-plot">
        <svg viewBox={VIEW_BOX} role="img" aria-label="Cost by task with calls overlay">
          <line className="uc-axis-line" x1={left} y1={bottom} x2={right} y2={bottom} />
          <text className="uc-axis" x={left} y={top - 6} data-axis-label="cost" fill={costColor}>$ log</text>
          <text className="uc-axis" x={right} y={top - 6} textAnchor="end" data-axis-label="calls" fill={callColor}>calls</text>
          {points.map((point, index) => {
            const x = left + slot * index;
            const barW = Math.max(2, slot * 0.5);
            const height = point.logHeight * (bottom - top);
            const y = bottom - height;
            const callY = bottom - (point.calls / peakCalls) * (bottom - top);
            return (
              <g className="uc-point" key={`${point.key}-${index}`} data-label={point.label}
                 data-cost={point.cost.toFixed(4)} data-calls={point.calls} data-log-height={point.logHeight.toFixed(4)}>
                <rect className="uc-bar uc-cost-bar" x={x + (slot - barW) / 2} y={y}
                      width={barW} height={height} rx={3} style={{ fill: costColor }} />
                <circle className="uc-cost-call-point" cx={x + slot / 2} cy={callY} r={3}
                        style={{ fill: callColor }} />
                <text className="uc-axis" x={x + slot / 2} y={bottom + 16} textAnchor="middle">{point.label}</text>
                <text className="uc-axis uc-cost-value" x={x + slot / 2} y={top + 8} textAnchor="middle">
                  ${point.cost.toFixed(4)}
                </text>
              </g>
            );
          })}
          {points.length > 1 && (
            <polyline className="uc-cost-call-line" data-series="calls"
                      points={points.map((point, index) =>
                        `${left + slot * index + slot / 2},${bottom - (point.calls / peakCalls) * (bottom - top)}`).join(" ")}
                      style={{ stroke: callColor }} />
          )}
          {empty && <text className="uc-empty-text" x="320" y="110" textAnchor="middle">n/a</text>}
        </svg>
      </div>
    </section>
  );
}

/** views.js:829-832 — calls by provider, brand SVG in every legend row. */
export function ProviderDoughnut({ providers, empty }: { providers: CostModel["providers"]; empty: boolean }) {
  const total = providers.reduce((sum, point) => sum + point.value, 0);
  let offset = 0;
  return (
    <section className="uc-card" data-chart-id="cProv" data-empty={empty ? "true" : "false"}>
      <h2>Provider calls</h2>
      <div className="uc-doughnut">
        <svg viewBox="0 0 200 200" role="img" aria-label="Provider call distribution">
          <circle className="uc-donut-track" cx="100" cy="100" r="70" />
          {providers.map((point) => {
            const pct = total > 0 ? (point.value / total) * 100 : 0;
            const dash = `${pct} ${100 - pct}`;
            const start = offset;
            offset += pct;
            return (
              <circle key={point.key} className="uc-donut-slice" data-provider={point.key}
                      data-calls={point.value} cx="100" cy="100" r="70" pathLength={100}
                      strokeDasharray={dash} strokeDashoffset={-start}
                      style={{ stroke: point.color }} />
            );
          })}
          <text className="uc-axis" x="100" y="104" textAnchor="middle">{empty ? "n/a" : total.toLocaleString("en-US")}</text>
        </svg>
        <ul className="uc-donut-legend">
          {providers.map((point) => (
            <li key={point.key} data-provider={point.key} style={{ color: point.color }}>
              <Mark path={point.icon} color={point.color} />
              <span>{point.label}</span>
              <span className="uc-num">{point.value.toLocaleString("en-US")}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ProviderTable({ rows }: { rows: readonly ProviderCostRow[] }) {
  return (
    <section className="uc-card">
      <h2>Provider cost</h2>
      <div className="uc-table-wrap">
        <table className="uc-table" data-table-id="tblProv">
          <thead>
            <tr>
              <th>Provider</th><th className="uc-num">Calls</th><th className="uc-num">Tokens</th>
              <th className="uc-num" title="Estimated bytes sent, including LAN, derived from tokens not measured">↑ Up (est)</th>
              <th className="uc-num" title="Estimated bytes received, including LAN, derived from tokens not measured">↓ Down (est)</th>
              <th className="uc-num">Est. cost</th><th className="uc-num">Models</th><th>Breakdown</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} data-provider={row.key}>
                <td className="uc-prov-cell"><Mark path={row.icon} color={row.color} /><span>{row.label}</span></td>
                <td className="uc-num">{row.calls.toLocaleString("en-US")}</td>
                <td className="uc-num">{compact(row.tokens)}</td>
                <td className="uc-num uc-bw-up">{fmtB(row.up)}</td>
                <td className="uc-num uc-bw-down">{fmtB(row.down)}</td>
                <td className="uc-num" style={{ color: row.color }}>{row.costText}</td>
                <td className="uc-num">{row.models}</td>
                <td><span className="uc-bar-track"><span className="uc-bar-fill" style={{ width: `${row.widthPct}%`, background: row.color }} /></span></td>
              </tr>
            ))}
            {!rows.length && <tr><td className="uc-nodata" colSpan={8}>n/a — no rows in this range</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ModelTable({ model }: { model: CostModel }) {
  return (
    <section className="uc-card">
      <h2>Cost by model</h2>
      <div className="uc-table-wrap">
        <table className="uc-table" data-table-id="tbl">
          <thead>
            <tr>
              <th>Model</th><th>Provider</th><th className="uc-num">Calls</th><th className="uc-num">In</th>
              <th className="uc-num">Out</th><th className="uc-num">Cache</th>
              <th className="uc-num">↑ Up (est)</th><th className="uc-num">↓ Down (est)</th>
              <th className="uc-num">Est. cost</th><th>Tasks</th>
            </tr>
          </thead>
          <tbody>
            {model.modelRows.map((row) => (
              <tr key={row.key} data-model={row.model} data-cost={row.costKind === "local" ? "local" : "other"}>
                <td className="uc-prov-cell"><Mark path={row.icon} color={row.color} />
                  <span className="uc-model-name" style={{ color: row.color }}>{row.model}</span></td>
                <td>{row.provider}</td>
                <td className="uc-num">{row.calls.toLocaleString("en-US")}</td>
                <td className="uc-num">{fmtB(row.inp)}</td>
                <td className="uc-num">{fmtB(row.outp)}</td>
                <td className="uc-num">{fmtB(row.cache)}</td>
                <td className="uc-num uc-bw-up">{fmtB(row.up)}</td>
                <td className="uc-num uc-bw-down">{fmtB(row.down)}</td>
                <td className="uc-num" data-cost-kind={row.costKind} title={row.costTitle || undefined}>{row.costText}</td>
                <td className="uc-task-cell"><span className="uc-bar-track"><span className="uc-bar-fill" style={{ width: `${row.widthPct}%`, background: row.color }} /></span>
                  <span className="uc-muted">{row.tasks.length ? row.tasks.join(", ") : "n/a"}</span></td>
              </tr>
            ))}
            {!model.modelRows.length && <tr><td className="uc-nodata" colSpan={10}>n/a — no models in this range</td></tr>}
          </tbody>
        </table>
      </div>
      {model.unpriced.length > 0 && (
        <p className="uc-unpriced-note" data-unpriced-count={model.unpriced.length}>
          Unpriced models (counted at $0, so cost is understated): {model.unpriced.map((row) => `${row.label} (${row.calls.toLocaleString("en-US")} calls)`).join(", ")}
        </p>
      )}
    </section>
  );
}

function ResendTable({ model }: { model: CostModel }) {
  return (
    <section className="uc-card" data-panel="resend">
      <h2>Re-sent context</h2>
      <p className="uc-meta" data-testid="resendsub">{model.resendNote}</p>
      <div className="uc-table-wrap">
        <table className="uc-table" data-table-id="resendtbl">
          <thead>
            <tr>
              <th>Session</th><th>Model</th><th className="uc-num">Calls</th>
              <th className="uc-num" title="Average prompt tokens per call">Avg context</th>
              <th className="uc-num" title="Share of prompt tokens served from cache">Cached</th>
              <th className="uc-num">Re-sent cost</th><th>Breakdown</th>
            </tr>
          </thead>
          <tbody>
            {model.resend.slice(0, 15).map((row) => (
              <tr key={row.id} className="resendrow" data-sid={row.id}>
                <td title={row.id}>{row.title}</td>
                <td className="uc-prov-cell"><Mark path={row.icon} color={row.color} /><span>{row.model}</span></td>
                <td className="uc-num">{row.calls.toLocaleString("en-US")}</td>
                <td className="uc-num">{row.ctxText}</td>
                <td className="uc-num">{row.cachedPct.toFixed(1)}%</td>
                <td className="uc-num">{row.costText}</td>
                <td><span className="uc-bar-track"><span className="uc-bar-fill" style={{ width: `${row.widthPct}%` }} /></span></td>
              </tr>
            ))}
            {!model.resend.length && (
              <tr><td className="uc-nodata" colSpan={7}>
                No session in this range has at least {RESEND_MIN} calls to average.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Attribution({ model }: { model: AttributionModel }) {
  if (model.hidden) return null;
  return (
    <section className="uc-card" data-panel="attribution">
      <h2>Cost attribution</h2>
      <div className="uc-attrib-grid">
        <div>
          <h3>By source</h3>
          {model.bySource.map((row) => (
            <div className="uc-attrib-row" key={row.source}>
              <span className="uc-strong">{row.source}</span><span className="uc-muted">{row.sessionsText}</span>
              <span className="uc-num">{row.costText}</span>
            </div>
          ))}
        </div>
        <div>
          <h3>By tool</h3>
          {model.byTool.length
            ? model.byTool.map((row) => (
              <div className="uc-attrib-row" key={row.tool}>
                <span className="uc-strong">{row.tool}</span><span className="uc-muted">{row.tokensText}</span>
                <span className="uc-num">{row.costText}</span>
              </div>
            ))
            : <p className="uc-muted">No tool-result tokens in range.</p>}
        </div>
        <div>
          <h3>By root session</h3>
          {model.byRoot.map((row) => (
            <div className="uc-attrib-row" key={row.id}>
              <span className="uc-strong">{row.title}</span>
              <span className="uc-muted" title="own cost, excluding descendants">{row.ownText}</span>
              <span className="uc-muted" title="cost of all descendant sessions">{row.descendantsText}</span>
              <span className="uc-num">{row.totalText}</span>
            </div>
          ))}
        </div>
        {model.byCron.length > 0 && (
          <div data-panel="attribution-cron">
            <h3>By cron</h3>
            {model.byCron.map((row) => (
              <div className="uc-attrib-row" key={row.name}>
                <span className="uc-strong">{row.name}</span><span className="uc-muted">{row.runsText}</span>
                <span className="uc-muted">{row.avgText}</span>
                <span className="uc-num" title="naive 30-day-window projection">{row.monthlyText}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="uc-meta">{model.footer}</p>
    </section>
  );
}

export default function CostTables({ model }: { model: CostModel }) {
  return (
    <div className="cost-panels">
      <TaskCostChart points={model.taskCosts} empty={model.empty} />
      <ProviderDoughnut providers={model.providers} empty={model.empty} />
      <ProviderTable rows={model.providerRows} />
      <ModelTable model={model} />
      <ResendTable model={model} />
      <Attribution model={model.attribution} />
    </div>
  );
}
